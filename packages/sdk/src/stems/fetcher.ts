import type { JamCouchID, StemCouchID } from '../types/ids.js';
import type { ResolvedStem } from '../types/stem.js';
import type { HttpTransport } from '../transport.js';
import type { StemBlob, StemCache } from './cache.js';

export type StemFetchLog =
  | { kind: 'size-mismatch'; stemId: StemCouchID; expected: number; actual: number };

export interface StemFetcherOptions {
  transport: HttpTransport;
  cache: StemCache;
  concurrency?: number;
  allowSizeMismatch?: boolean;
  logger?: (entry: StemFetchLog) => void;
}

export class StemIntegrityError extends Error {
  readonly name = 'StemIntegrityError';
  constructor(
    readonly stemId: StemCouchID,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Stem ${stemId}: expected ${expected} bytes, got ${actual}`);
  }
}

export class StemFetcher {
  private readonly transport: HttpTransport;
  private readonly cache: StemCache;
  private readonly allowSizeMismatch: boolean;
  private readonly logger?: (entry: StemFetchLog) => void;

  constructor(opts: StemFetcherOptions) {
    this.transport = opts.transport;
    this.cache = opts.cache;
    this.allowSizeMismatch = opts.allowSizeMismatch ?? false;
    this.logger = opts.logger;
  }

  async fetchOne(resolved: ResolvedStem, jamId: JamCouchID): Promise<StemBlob> {
    const hit = await this.cache.get(resolved.stemId);
    if (hit) return hit;

    const bytes = await this.transport.requestBinary({
      url: resolved.url,
      method: 'GET',
      accept: resolved.mime,
    });

    if (bytes.length !== resolved.length) {
      if (!this.allowSizeMismatch) {
        throw new StemIntegrityError(resolved.stemId, resolved.length, bytes.length);
      }
      this.logger?.({
        kind: 'size-mismatch',
        stemId: resolved.stemId,
        expected: resolved.length,
        actual: bytes.length,
      });
    }

    await this.cache.put(
      { stemId: resolved.stemId, jamId, format: resolved.format },
      bytes,
    );

    return {
      bytes,
      format: resolved.format,
      length: bytes.length,
      source: 'network',
    };
  }
}
