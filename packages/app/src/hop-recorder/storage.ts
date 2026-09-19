import type { FsAdapter } from '@hoppper/sdk';
import type { JamCouchID } from '@hoppper/sdk';
import {
  parseSequence,
  serializeSequence,
  type HopSequence,
} from './types.js';

export interface SequenceStorageOptions {
  fs: FsAdapter;
  /** Directory under which jam folders are created. */
  root: string;
}

export interface SequenceStorage {
  saveSequence(seq: HopSequence): Promise<void>;
  loadSequence(jamId: JamCouchID, id: string): Promise<HopSequence>;
  listSequences(jamId: JamCouchID): Promise<HopSequence[]>;
  /** Every jam's takes together, newest first — for the Hops page. */
  listAllSequences(): Promise<HopSequence[]>;
  deleteSequence(jamId: JamCouchID, id: string): Promise<void>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'ENOENT'
  );
}

export function createSequenceStorage(
  opts: SequenceStorageOptions,
): SequenceStorage {
  const { fs, root } = opts;

  const jamDir = (jamId: JamCouchID) => `${root}/${jamId}`;
  const filePath = (jamId: JamCouchID, id: string) =>
    `${jamDir(jamId)}/${id}.json`;

  const newestFirst = (a: HopSequence, b: HopSequence) =>
    a.recordedAt < b.recordedAt ? 1 : -1;

  async function listSequences(jamId: JamCouchID): Promise<HopSequence[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(jamDir(jamId));
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
    const sequences: HopSequence[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const bytes = await fs.readFile(`${jamDir(jamId)}/${entry}`);
        sequences.push(parseSequence(decoder.decode(bytes)));
      } catch {
        // Malformed file in the sequences dir; skip rather than fail
        // the entire listing.
      }
    }
    return sequences.sort(newestFirst);
  }

  return {
    async saveSequence(seq) {
      const dir = jamDir(seq.jamId);
      await fs.mkdir(dir, { recursive: true });
      const finalPath = filePath(seq.jamId, seq.id);
      const tmpPath = `${finalPath}.tmp`;
      const bytes = encoder.encode(serializeSequence(seq));
      await fs.writeFile(tmpPath, bytes);
      await fs.rename(tmpPath, finalPath);
    },

    async loadSequence(jamId, id) {
      const bytes = await fs.readFile(filePath(jamId, id));
      return parseSequence(decoder.decode(bytes));
    },

    listSequences,

    async listAllSequences() {
      let jamIds: string[];
      try {
        jamIds = await fs.readdir(root);
      } catch (err) {
        if (isNotFound(err)) return [];
        throw err;
      }
      // Anything beside the jam folders (a .DS_Store, say) isn't a jam: skip
      // it rather than fail the whole page.
      const perJam = await Promise.all(
        jamIds.map((jamId) => listSequences(jamId).catch(() => [])),
      );
      return perJam.flat().sort(newestFirst);
    },

    async deleteSequence(jamId, id) {
      await fs.unlink(filePath(jamId, id));
    },
  };
}
