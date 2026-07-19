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

    async listSequences(jamId) {
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
      // Newest-first by recordedAt.
      sequences.sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));
      return sequences;
    },

    async deleteSequence(jamId, id) {
      await fs.unlink(filePath(jamId, id));
    },
  };
}
