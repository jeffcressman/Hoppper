// Minimal filesystem surface used by stem caches. The default impl wraps
// node:fs/promises; Tauri swaps in its own adapter in Phase 5 so all reads and
// writes go through Tauri commands (sandbox-friendly, CORS-free, etc.).

// Lazy import so the SDK bundles for the browser/Tauri without pulling
// node:fs/promises at module-evaluation time.
async function nodeFs() {
  return await import('node:fs/promises');
}

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
      const fs = await nodeFs();
      const buf = await fs.readFile(path);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    async writeFile(path, bytes) {
      const fs = await nodeFs();
      await fs.writeFile(path, bytes);
    },
    async rename(from, to) {
      const fs = await nodeFs();
      await fs.rename(from, to);
    },
    async unlink(path) {
      const fs = await nodeFs();
      try {
        await fs.unlink(path);
      } catch (err) {
        if (isNotFound(err)) return;
        throw err;
      }
    },
    async mkdir(path, opts) {
      const fs = await nodeFs();
      await fs.mkdir(path, opts);
    },
    async readdir(path) {
      const fs = await nodeFs();
      return await fs.readdir(path);
    },
    async stat(path) {
      const fs = await nodeFs();
      try {
        const s = await fs.stat(path);
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
