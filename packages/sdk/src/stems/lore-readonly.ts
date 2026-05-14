import type { StemCouchID } from '../types/ids.js';
import type { StemFormat } from '../types/stem.js';
import {
  ReadonlyCacheError,
  type StemBlob,
  type StemCache,
  type StemCachePutKey,
} from './cache.js';
import { isNotFound, nodeFsAdapter, type FsAdapter } from './fs-adapter.js';

interface IndexEntry {
  jamId: string;
  format: StemFormat;
}

// Read-only view over a LORE stem_v2 directory: bytes stay where LORE put them,
// no duplication. The V2 layout is <root>/<jamCouchID>/<firstChar>/<stemId>.<ext>;
// since we only know stemId at lookup time, we build a stemId -> (jamId, format)
// index lazily on first access (one directory scan per process).
export class ReadonlyLoreStemDir implements StemCache {
  readonly writable = false;
  private readonly root: string;
  private readonly fs: FsAdapter;
  private readonly index = new Map<StemCouchID, IndexEntry>();
  private indexBuilt = false;
  private indexPromise?: Promise<void>;

  constructor(opts: { stemV2Root: string; fs?: FsAdapter }) {
    this.root = opts.stemV2Root;
    this.fs = opts.fs ?? nodeFsAdapter();
  }

  async has(stemId: StemCouchID): Promise<boolean> {
    await this.ensureIndex();
    return this.index.has(stemId);
  }

  async get(stemId: StemCouchID): Promise<StemBlob | null> {
    await this.ensureIndex();
    const entry = this.index.get(stemId);
    if (!entry) return null;
    const path = `${this.root}/${entry.jamId}/${stemId.charAt(0)}/${stemId}.${entry.format}`;
    const bytes = await this.fs.readFile(path);
    return { bytes, format: entry.format, length: bytes.length, source: 'lore' };
  }

  async put(_key: StemCachePutKey, _bytes: Uint8Array): Promise<void> {
    throw new ReadonlyCacheError('put');
  }

  async evict(_stemId: StemCouchID): Promise<void> {
    throw new ReadonlyCacheError('evict');
  }

  private async ensureIndex(): Promise<void> {
    if (this.indexBuilt) return;
    if (!this.indexPromise) {
      this.indexPromise = this.buildIndex().then(() => {
        this.indexBuilt = true;
      });
    }
    await this.indexPromise;
  }

  private async buildIndex(): Promise<void> {
    const jamDirs = await readdirOrEmpty(this.fs, this.root);
    for (const jamId of jamDirs) {
      const charDirs = await readdirOrEmpty(this.fs, `${this.root}/${jamId}`);
      for (const charDir of charDirs) {
        const files = await readdirOrEmpty(this.fs, `${this.root}/${jamId}/${charDir}`);
        for (const fname of files) {
          const m = STEM_FILE_RE.exec(fname);
          if (!m) continue;
          const stemId = m[1] as StemCouchID;
          const format = m[2] as StemFormat;
          this.index.set(stemId, { jamId, format });
        }
      }
    }
  }
}

const STEM_FILE_RE = /^([^.]+)\.(ogg|flac)$/;

async function readdirOrEmpty(fs: FsAdapter, path: string): Promise<string[]> {
  try {
    return await fs.readdir(path);
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
}
