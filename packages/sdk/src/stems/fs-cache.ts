import type { StemCouchID } from '../types/ids.js';
import type { StemFormat } from '../types/stem.js';
import type { StemBlob, StemCache, StemCachePutKey } from './cache.js';
import { nodeFsAdapter, type FsAdapter } from './fs-adapter.js';

interface IndexEntry {
  jamId: string;
  format: StemFormat;
}

// Writable stem cache laid out per LORE's V2 convention:
//   <root>/<jamCouchID>/<first-char-of-stemID>/<stemCouchID>.<ext>
// Writes are atomic via *.tmp + rename. On first access the cache scans the
// root once to populate an in-memory stemId -> (jamId, format) index, so
// stems written by a previous session survive process restarts.
export class FilesystemStemCache implements StemCache {
  readonly writable = true;
  private readonly root: string;
  private readonly fs: FsAdapter;
  private readonly index = new Map<StemCouchID, IndexEntry>();
  private indexBuilt = false;
  private indexPromise?: Promise<void>;

  constructor(opts: { root: string; fs?: FsAdapter }) {
    this.root = opts.root;
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
    const bytes = await this.fs.readFile(this.pathFor(stemId, entry.jamId, entry.format));
    return { bytes, format: entry.format, length: bytes.length, source: 'fs' };
  }

  async put(key: StemCachePutKey, bytes: Uint8Array): Promise<void> {
    await this.ensureIndex();
    const dir = `${this.root}/${key.jamId}/${firstChar(key.stemId)}`;
    await this.fs.mkdir(dir, { recursive: true });
    const finalPath = `${dir}/${key.stemId}.${key.format}`;
    const tmpPath = `${finalPath}.tmp`;
    await this.fs.writeFile(tmpPath, bytes);
    await this.fs.rename(tmpPath, finalPath);

    // If a different-format file exists for the same stemId from a prior put,
    // remove it so we don't keep stale bytes around.
    const prior = this.index.get(key.stemId);
    if (prior && prior.format !== key.format) {
      await this.fs.unlink(this.pathFor(key.stemId, prior.jamId, prior.format));
    }
    this.index.set(key.stemId, { jamId: key.jamId, format: key.format });
  }

  async evict(stemId: StemCouchID): Promise<void> {
    await this.ensureIndex();
    const entry = this.index.get(stemId);
    if (!entry) return;
    await this.fs.unlink(this.pathFor(stemId, entry.jamId, entry.format));
    this.index.delete(stemId);
  }

  private pathFor(stemId: StemCouchID, jamId: string, format: StemFormat): string {
    return `${this.root}/${jamId}/${firstChar(stemId)}/${stemId}.${format}`;
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

function firstChar(stemId: StemCouchID): string {
  return stemId.charAt(0);
}

async function readdirOrEmpty(fs: FsAdapter, path: string): Promise<string[]> {
  try {
    return await fs.readdir(path);
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}
