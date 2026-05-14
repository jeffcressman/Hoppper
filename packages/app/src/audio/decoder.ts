import type { StemFormat } from '@hoppper/sdk';
import type { AudioBufferLike } from './audio-buffer-cache.js';

// Per-format decoder. Real implementations (libflac.js, native decodeAudioData)
// arrive in Phase 6 wiring; for the unit tests we pass stubs.
export interface FormatDecoder {
  decode(bytes: Uint8Array): Promise<AudioBufferLike>;
}

export interface Decoder {
  decode(bytes: Uint8Array, format: StemFormat): Promise<AudioBufferLike>;
}

export interface DecoderRegistry {
  ogg: FormatDecoder;
  flac: FormatDecoder;
}

export class UnsupportedFormatError extends Error {
  readonly format: string;
  constructor(format: string) {
    super(`Unsupported stem format: ${format}`);
    this.name = 'UnsupportedFormatError';
    this.format = format;
  }
}

export function createDecoder(registry: DecoderRegistry): Decoder {
  return {
    async decode(bytes, format) {
      switch (format) {
        case 'ogg':
          return registry.ogg.decode(bytes);
        case 'flac':
          return registry.flac.decode(bytes);
        default:
          throw new UnsupportedFormatError(format);
      }
    },
  };
}
