import type { JamCouchID, RiffCouchID, StemCouchID } from './types/ids.js';
import type { RiffDocument, RiffSlot } from './types/riff.js';
import type {
  ResolvedStem,
  StemAudioAttachment,
  StemDocument,
  StemFormat,
} from './types/stem.js';

// Endlesss-quirk-aware response parsing helpers.
// See docs/protocol/overview.md "Known Quirks and Damaged-Data Handling".

// Quirk #1: some server versions wrote "length":"13" (string) instead of
// "length":13 (number). LORE handles this by regex-replacing the raw body
// before deserialising. We do the same.
export function applyLengthQuirk(rawBody: string): string {
  return rawBody.replace(/"length":"(\d+)"/g, '"length":$1');
}

// Fallback for object-level access when the body wasn't pre-massaged.
// Accepts number, digit-string, or missing; returns 0 for unparseable input.
export function coerceLength(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
    return 0;
  }
  return 0;
}

interface RawRiffPlaybackEntry {
  slot?: {
    current?: {
      on?: boolean | number;
      currentLoop?: string;
      gain?: number;
    };
  };
}

interface RawRiffDocument {
  _id: string;
  state: {
    bps: number;
    barLength: number;
    playback: RawRiffPlaybackEntry[];
  };
  userName: string;
  created: number;
  root: number;
  scale: number;
  app_version?: number;
  magnitude?: number;
}

export function parseRiffDocument(raw: RawRiffDocument, jamId: JamCouchID): RiffDocument {
  const slots: RiffSlot[] = [];
  const playback = Array.isArray(raw.state.playback) ? raw.state.playback : [];
  for (let i = 0; i < 8; i++) {
    slots.push(parseSlot(playback[i]));
  }

  const doc: RiffDocument = {
    riffId: raw._id as RiffCouchID,
    jamId,
    userName: raw.userName,
    createdAt: raw.created,
    bps: raw.state.bps,
    bpm: Math.ceil(raw.state.bps * 60 * 100) / 100,
    barLength: raw.state.barLength,
    root: raw.root,
    scale: raw.scale,
    slots,
  };
  if (raw.app_version !== undefined) doc.appVersion = raw.app_version;
  if (raw.magnitude !== undefined) doc.magnitude = raw.magnitude;
  return doc;
}

function parseSlot(raw: RawRiffPlaybackEntry | undefined): RiffSlot {
  const cur = raw?.slot?.current;
  if (!cur) return { on: false, stemId: null, gain: 0 };

  // Quirk #2: `on` may be 0/1 instead of bool.
  const onRaw = Boolean(cur.on);
  const loop = cur.currentLoop ?? '';
  // Quirk #3: empty currentLoop forces on=false even if on is true.
  const on = onRaw && loop !== '';
  return {
    on,
    stemId: loop !== '' ? loop : null,
    gain: typeof cur.gain === 'number' ? cur.gain : 0,
  };
}

interface RawStemAudioAttachment {
  endpoint?: string;
  key?: string;
  bucket?: string;
  url?: string;
  length?: number | string;
  mime?: string;
}

interface RawStemDocument {
  _id: string;
  bps: number;
  length16ths: number;
  originalPitch: number;
  barLength: number;
  presetName: string;
  creatorUserName: string;
  primaryColour: string;
  sampleRate: number;
  created: number;
  cdn_attachments?: {
    oggAudio?: RawStemAudioAttachment;
    flacAudio?: RawStemAudioAttachment;
  };
  isDrum?: boolean;
  isNote?: boolean;
  isBass?: boolean;
  isMic?: boolean;
}

export function parseStemDocument(raw: RawStemDocument): StemDocument {
  const cdn = raw.cdn_attachments ?? {};
  const doc: StemDocument = {
    stemId: raw._id as StemCouchID,
    bps: raw.bps,
    length16ths: raw.length16ths,
    originalPitch: raw.originalPitch,
    barLength: raw.barLength,
    presetName: raw.presetName,
    creatorUserName: raw.creatorUserName,
    primaryColour: raw.primaryColour,
    sampleRate: raw.sampleRate,
    createdAt: raw.created,
    ogg: parseStemAttachment(cdn.oggAudio, 'ogg'),
    flac: parseStemAttachment(cdn.flacAudio, 'flac'),
  };
  if (raw.isDrum !== undefined) doc.isDrum = raw.isDrum;
  if (raw.isNote !== undefined) doc.isNote = raw.isNote;
  if (raw.isBass !== undefined) doc.isBass = raw.isBass;
  if (raw.isMic !== undefined) doc.isMic = raw.isMic;
  return doc;
}

function parseStemAttachment(
  raw: RawStemAudioAttachment | undefined,
  format: StemFormat,
): StemAudioAttachment | null {
  if (!raw) return null;
  let endpoint = raw.endpoint ?? '';
  let key = raw.key ?? '';
  let bucket = raw.bucket ?? '';
  const url = raw.url ?? '';
  const length = coerceLength(raw.length);

  // Treat fully-empty blocks as absent (matches LORE's early-return path).
  if (!endpoint && !key && !bucket && !url && length === 0) return null;

  // Quirk #4: missing key → derive from URL path.
  if (!key && url) {
    try {
      const parsed = new URL(url);
      key = parsed.pathname.replace(/^\//, '');
    } catch {
      // leave key empty; downstream resolveStemUrl will still fall back to url
    }
  }

  // Quirk #5: endpoint with http(s):// prefix → strip to hostname-style suffix.
  if (endpoint.startsWith('http')) {
    const slash = endpoint.lastIndexOf('/');
    if (slash >= 0 && slash < endpoint.length - 1) {
      endpoint = endpoint.slice(slash + 1);
    }
  }

  // Quirk #6: bucket already prepended to endpoint → clear bucket.
  if (bucket && endpoint.startsWith(bucket)) {
    bucket = '';
  }

  const attachment: StemAudioAttachment = {
    format,
    endpoint,
    key,
    url,
    length,
    mime: raw.mime ?? (format === 'flac' ? 'audio/flac' : 'audio/ogg'),
  };
  if (bucket) attachment.bucket = bucket;
  return attachment;
}

export function resolveStemUrl(stem: StemDocument): ResolvedStem | null {
  const flac = stem.flac && stem.flac.length > 0 ? stem.flac : null;
  const chosen = flac ?? (stem.ogg && (stem.ogg.length > 0 || stem.ogg.url) ? stem.ogg : null);
  if (!chosen) return null;

  const url = chosen.url || buildAttachmentUrl(chosen);
  if (!url) return null;
  return {
    stemId: stem.stemId,
    format: chosen.format,
    url,
    length: chosen.length,
    mime: chosen.mime,
  };
}

function buildAttachmentUrl(attachment: StemAudioAttachment): string {
  if (!attachment.endpoint || !attachment.key) return '';
  const host = attachment.bucket ? `${attachment.bucket}.${attachment.endpoint}` : attachment.endpoint;
  return `https://${host}/${attachment.key}`;
}
