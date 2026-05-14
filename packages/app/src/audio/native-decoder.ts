import type { FormatDecoder } from './decoder.js';

// AudioContext.decodeAudioData natively handles Ogg Vorbis in every Chromium
// build and FLAC since Chromium 117 (also in WebKit). For browsers that lack
// FLAC support this will reject — Phase 6 open question whether to bundle
// libflac.js as a fallback (see docs/phases/phase-6-audio-engine.md).
export function createNativeDecoder(context: AudioContext): FormatDecoder {
  return {
    async decode(bytes) {
      // decodeAudioData detaches the input ArrayBuffer; pass a copy so the
      // caller's Uint8Array stays usable (the StemFetcher may keep a ref).
      const copy = bytes.slice().buffer;
      return await context.decodeAudioData(copy);
    },
  };
}
