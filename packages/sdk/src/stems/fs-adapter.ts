import {
  readFile,
  writeFile,
  rename,
  unlink,
  mkdir,
  readdir,
  stat,
} from 'node:fs/promises';

// Minimal filesystem surface used by stem caches. The default impl wraps
// node:fs/promises; Tauri swaps in its own adapter in Phase 5 so all reads and
// writes go through Tauri commands (sandbox-friendly, CORS-free, etc.).

export interface FsAdapter {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  mkdir(path: string, opts: { recursive: boolean }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  // null = not found; any other error propagates.
  stat(path: string): Promise<{ size: number } | null>;
}

export function nodeFsAdapter(): FsAdapter {
  return {
    async readFile(path) {
      const buf = await readFile(path);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    async writeFile(path, bytes) {
      await writeFile(path, bytes);
    },
    async rename(from, to) {
      await rename(from, to);
    },
    async unlink(path) {
      try {
        await unlink(path);
      } catch (err) {
        if (isNotFound(err)) return;
        throw err;
      }
    },
    async mkdir(path, opts) {
      await mkdir(path, opts);
    },
    async readdir(path) {
      return await readdir(path);
    },
    async stat(path) {
      try {
        const s = await stat(path);
        return { size: s.size };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
  };
}

export function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
  );
}
