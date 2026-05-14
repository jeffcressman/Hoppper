import type { JamCouchID, RiffCouchID } from '../types/ids.js';
import type { RiffDocument } from '../types/riff.js';
import type { ResolvedStem } from '../types/stem.js';
import type { StemFetcher } from './fetcher.js';

// Minimal slice of EndlesssClient used by the prefetcher. Defined structurally
// so tests can supply a stub and the SDK's EndlesssClient satisfies it for free.
export interface PrefetchClient {
  getRiffs(jamId: JamCouchID, riffIds: RiffCouchID[]): Promise<RiffDocument[]>;
  getStemUrls(jamId: JamCouchID, riff: RiffDocument): Promise<(ResolvedStem | null)[]>;
}

export interface PrefetchProgress {
  riffId: RiffCouchID;
  done: number;
  total: number;
  cached: number;
  downloaded: number;
  failed: number;
}

export interface PrefetchResult {
  riffsCompleted: number;
  riffsFailed: number;
  cancelled: boolean;
}

export interface PrefetchHandle {
  readonly progress: AsyncIterable<PrefetchProgress>;
  cancel(): void;
  done(): Promise<PrefetchResult>;
}

export interface PrefetchOptions {
  client: PrefetchClient;
  fetcher: StemFetcher;
  jamId: JamCouchID;
  riffIds: RiffCouchID[];
  windowSize?: number;
}

export function prefetchRiffs(opts: PrefetchOptions): PrefetchHandle {
  const windowSize = opts.windowSize ?? 2;

  let cancelled = false;
  const progressQueue = new ProgressQueue<PrefetchProgress>();
  const counters = { completed: 0, failed: 0 };

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      if (cancelled) return;
      const slot = cursor++;
      if (slot >= opts.riffIds.length) return;
      const riffId = opts.riffIds[slot]!;
      await processOne(riffId);
    }
  };

  const processOne = async (riffId: RiffCouchID): Promise<void> => {
    const progress: PrefetchProgress = {
      riffId,
      done: 0,
      total: 0,
      cached: 0,
      downloaded: 0,
      failed: 0,
    };

    try {
      const riffs = await opts.client.getRiffs(opts.jamId, [riffId]);
      const riff = riffs.find((r) => r.riffId === riffId);
      if (!riff) {
        progress.failed = 1;
        counters.failed++;
        progressQueue.push(progress);
        return;
      }

      const resolved = await opts.client.getStemUrls(opts.jamId, riff);
      const slots = resolved.filter((s): s is ResolvedStem => s !== null);
      progress.total = slots.length;

      for (const stem of slots) {
        if (cancelled) break;
        try {
          const blob = await opts.fetcher.fetchOne(stem, opts.jamId);
          if (blob.source === 'network') progress.downloaded++;
          else progress.cached++;
        } catch {
          progress.failed++;
        }
        progress.done++;
      }

      if (progress.failed > 0) counters.failed++;
      else counters.completed++;
    } catch {
      progress.failed = Math.max(progress.failed, 1);
      counters.failed++;
    }

    progressQueue.push(progress);
  };

  const workerCount = Math.min(windowSize, opts.riffIds.length);
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) workers.push(worker());

  const allDone = Promise.all(workers).then(() => {
    progressQueue.close();
  });

  return {
    get progress() {
      return progressQueue.iterable();
    },
    cancel() {
      cancelled = true;
    },
    async done(): Promise<PrefetchResult> {
      await allDone;
      return {
        riffsCompleted: counters.completed,
        riffsFailed: counters.failed,
        cancelled,
      };
    },
  };
}

// Single-producer/single-consumer async queue. Buffers values pushed before a
// consumer attaches so callers can `await handle.done()` first and still
// receive every progress event later via `for await ... of handle.progress`.
class ProgressQueue<T> {
  private readonly buffer: T[] = [];
  private waiter?: (value: IteratorResult<T>) => void;
  private closed = false;

  push(value: T): void {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = undefined;
      w({ value, done: false });
      return;
    }
    this.buffer.push(value);
  }

  close(): void {
    this.closed = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = undefined;
      w({ value: undefined as unknown as T, done: true });
    }
  }

  iterable(): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<T>> => {
          if (this.buffer.length > 0) {
            return Promise.resolve({ value: this.buffer.shift()!, done: false });
          }
          if (this.closed) {
            return Promise.resolve({ value: undefined as unknown as T, done: true });
          }
          return new Promise((resolve) => {
            this.waiter = resolve;
          });
        },
      }),
    };
  }
}
