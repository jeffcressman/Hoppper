// Minimal Ogg Vorbis / FLAC header readers, for tests that need to know what
// a stem's encoded audio actually says about itself — as opposed to what the
// stem document claims. Enough of each container to read sample rate, channel
// count and length; no decoding.
//
// Used by the live stem-timing probe in integration.test.ts. See
// docs/protocol/overview.md:537 (LORE resamples when a stem's declared sample
// rate differs from the playback target).

import type { StemFormat } from '../../src/types/index.js';

export interface AudioHeader {
  sampleRate: number;
  channels: number;
  /** FLAC only; null for Ogg Vorbis, which doesn't declare a bit depth. */
  bitsPerSample: number | null;
  /** Null when the container doesn't say (0 granule / 0 total samples). */
  totalSamples: number | null;
  /** Null when totalSamples is unknown. */
  durationSec: number | null;
}

function startsWith(bytes: Uint8Array, ascii: string, at = 0): boolean {
  if (bytes.length < at + ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[at + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

/** Offset of the last "OggS" capture pattern, or -1. */
function lastOggPageOffset(bytes: Uint8Array): number {
  for (let i = bytes.length - 27; i >= 0; i--) {
    if (
      bytes[i] === 0x4f && // O
      bytes[i + 1] === 0x67 && // g
      bytes[i + 2] === 0x67 && // g
      bytes[i + 3] === 0x53 // S
    ) {
      return i;
    }
  }
  return -1;
}

function readOgg(bytes: Uint8Array): AudioHeader {
  if (!startsWith(bytes, 'OggS')) {
    throw new Error('not an Ogg stream: missing OggS capture pattern');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // First page: 27-byte header, then `page_segments` segment lengths, then the
  // Vorbis identification packet.
  const pageSegments = bytes[26]!;
  const identAt = 27 + pageSegments;
  if (!startsWith(bytes, '\x01vorbis', identAt)) {
    throw new Error('not an Ogg Vorbis stream: first packet is not a Vorbis ident header');
  }
  const channels = bytes[identAt + 11]!;
  const sampleRate = view.getUint32(identAt + 12, true);
  if (sampleRate <= 0) throw new Error('Ogg Vorbis ident header declares a zero sample rate');

  // Length lives in the granule position of the final page: for Vorbis that is
  // a PCM sample count.
  const lastPage = lastOggPageOffset(bytes);
  let totalSamples: number | null = null;
  if (lastPage >= 0) {
    const granule = view.getBigUint64(lastPage + 6, true);
    if (granule > 0n) totalSamples = Number(granule);
  }

  return {
    sampleRate,
    channels,
    bitsPerSample: null,
    totalSamples,
    durationSec: totalSamples === null ? null : totalSamples / sampleRate,
  };
}

function readFlac(bytes: Uint8Array): AudioHeader {
  if (!startsWith(bytes, 'fLaC')) {
    throw new Error('not a FLAC stream: missing fLaC marker');
  }
  // 4-byte metadata block header, then STREAMINFO must be the first block.
  const blockType = bytes[4]! & 0x7f;
  if (blockType !== 0) {
    throw new Error(`not a FLAC stream: first metadata block is type ${blockType}, not STREAMINFO`);
  }
  const s = 8; // STREAMINFO payload
  if (bytes.length < s + 18) throw new Error('truncated FLAC STREAMINFO block');

  // 20 bits sample rate | 3 bits (channels - 1) | 5 bits (bits per sample - 1)
  // | 36 bits total samples, starting 10 bytes into STREAMINFO.
  const b0 = bytes[s + 10]!;
  const b1 = bytes[s + 11]!;
  const b2 = bytes[s + 12]!;
  const b3 = bytes[s + 13]!;
  const sampleRate = (b0 << 12) | (b1 << 4) | (b2 >>> 4);
  const channels = ((b2 >>> 1) & 0x07) + 1;
  const bitsPerSample = (((b2 & 0x01) << 4) | (b3 >>> 4)) + 1;
  if (sampleRate <= 0) throw new Error('FLAC STREAMINFO declares a zero sample rate');

  // Top 4 bits of the 36-bit count are the low nibble of b3; multiply rather
  // than shift, since the value can exceed 32 bits.
  const high = b3 & 0x0f;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const low = view.getUint32(s + 14);
  const totalSamples = high * 2 ** 32 + low;

  return {
    sampleRate,
    channels,
    bitsPerSample,
    totalSamples: totalSamples > 0 ? totalSamples : null,
    durationSec: totalSamples > 0 ? totalSamples / sampleRate : null,
  };
}

export function readAudioHeader(bytes: Uint8Array, format: StemFormat): AudioHeader {
  switch (format) {
    case 'ogg':
      return readOgg(bytes);
    case 'flac':
      return readFlac(bytes);
    default:
      throw new Error(`unsupported stem format: ${String(format)}`);
  }
}
