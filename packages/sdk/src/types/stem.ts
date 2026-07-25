import type { StemCouchID } from './ids.js';

export type StemFormat = 'ogg' | 'flac';

export interface StemAudioAttachment {
  format: StemFormat;
  endpoint: string;
  key: string;
  bucket?: string;
  url: string;
  length: number;
  mime: string;
}

export interface StemDocument {
  stemId: StemCouchID;
  bps: number;
  length16ths: number;
  originalPitch: number;
  barLength: number;
  presetName: string;
  creatorUserName: string;
  primaryColour: string;
  sampleRate: number;
  createdAt: number;
  isDrum?: boolean;
  isNote?: boolean;
  isBass?: boolean;
  isMic?: boolean;
  ogg: StemAudioAttachment | null;
  flac: StemAudioAttachment | null;
}

// A stem ready to play: format chosen, URL fully resolved, and the musical
// facts a player needs. The stem's own `bps` is not decoration: a rifff can
// reuse a stem recorded at another tempo, and playback has to be rate-scaled
// by `riff.bps / stem.bps` to fit (LORE, live.riff.cpp).
export interface ResolvedStem {
  stemId: StemCouchID;
  format: StemFormat;
  url: string;
  /** Size of the audio attachment in bytes, per the CDN metadata. */
  byteLength: number;
  mime: string;
  /** The stem's own tempo, which may differ from the rifff playing it. */
  bps: number;
  /** The stem's length in sixteenth notes, at its own `bps`. */
  length16ths: number;
}
