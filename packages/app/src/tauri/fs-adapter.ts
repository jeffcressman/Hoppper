import {
  mkdir,
  readDir,
  readFile,
  remove,
  rename,
  stat,
  writeFile,
} from '@tauri-apps/plugin-fs';
import type { FsAdapter } from '@hoppper/sdk';

// Tauri-backed FsAdapter for the SDK's stem caches. Delegates to
// tauri-plugin-fs; not-found errors are translated to the SDK contract
// (stat → null, unlink → no-op) so callers can write the same code against
// the node adapter in tests and the Tauri adapter at runtime.
export function tauriFsAdapter(): FsAdapter {
  return {
    async readFile(path) {
      try {
        return await readFile(path);
      } catch (err) {
        throw normalizeFsError(err);
      }
    },
    async writeFile(path, bytes) {
      await writeFile(path, bytes);
    },
    async rename(from, to) {
      await rename(from, to);
    },
    async unlink(path) {
      try {
        await remove(path);
      } catch (err) {
        if (isNotFoundError(err)) return;
        throw err;
      }
    },
    async mkdir(path, opts) {
      await mkdir(path, opts);
    },
    async readdir(path) {
      try {
        const entries = await readDir(path);
        return entries.map((e) => e.name);
      } catch (err) {
        // Translate Tauri's string-message error into a Node-shaped one
        // so consumers using `err.code === 'ENOENT'` (e.g. the SDK's
        // FilesystemStemCache.buildIndex, hop-recorder storage) can
        // detect missing directories without platform-specific checks.
        throw normalizeFsError(err);
      }
    },
    async stat(path) {
      try {
        const info = await stat(path);
        return { size: info.size };
      } catch (err) {
        if (isNotFoundError(err)) return null;
        throw err;
      }
    },
  };
}

// Tauri error messages for missing files vary across platforms; match the
// patterns we've seen rather than relying on a single error code.
function isNotFoundError(err: unknown): boolean {
  const msg = typeof err === 'string' ? err : (err as { message?: string } | null)?.message;
  if (!msg) return false;
  return (
    msg.includes('not found') ||
    msg.includes('No such file') ||
    msg.includes('os error 2') ||
    msg.includes('cannot find')
  );
}

function normalizeFsError(err: unknown): Error {
  if (!isNotFoundError(err)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  const wrapped = err instanceof Error ? err : new Error(String(err));
  (wrapped as Error & { code: string }).code = 'ENOENT';
  return wrapped;
}
