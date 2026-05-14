import type { JamCouchID, ResolvedStem, StemFetcher } from '@hoppper/sdk';
import type { ByteSource } from './stem-loader.js';

// Bridge between the SDK's StemFetcher (which caches bytes on disk and
// returns a StemBlob) and the audio engine's narrower ByteSource interface.
export function createSdkByteSource(fetcher: StemFetcher): ByteSource {
  return {
    async fetch(stem: ResolvedStem, jamId: JamCouchID): Promise<Uint8Array> {
      const blob = await fetcher.fetchOne(stem, jamId);
      return blob.bytes;
    },
  };
}
