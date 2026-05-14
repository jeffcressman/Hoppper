import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureVaultKey, VAULT_KEY_BYTES } from '../../src/tauri/vault-key';

interface FakeFs {
  files: Map<string, Uint8Array>;
  readFile: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
}

function makeFs(seed: Record<string, Uint8Array> = {}): FakeFs {
  const files = new Map(Object.entries(seed));
  return {
    files,
    readFile: vi.fn(async (path: string) => {
      const v = files.get(path);
      if (!v) throw new Error('No such file or directory');
      return v;
    }),
    writeFile: vi.fn(async (path: string, bytes: Uint8Array) => {
      files.set(path, bytes);
    }),
  };
}

const keyPath = '/app-data/vault.key';

let randomBytes: ReturnType<typeof vi.fn>;

beforeEach(() => {
  randomBytes = vi.fn((n: number) => new Uint8Array(n).fill(0x42));
});

describe('ensureVaultKey', () => {
  it('generates and persists a 32-byte key on first run', async () => {
    const fs = makeFs();
    const key = await ensureVaultKey({ keyPath, fs, randomBytes });

    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.byteLength).toBe(VAULT_KEY_BYTES);
    expect(randomBytes).toHaveBeenCalledWith(VAULT_KEY_BYTES);
    expect(fs.writeFile).toHaveBeenCalledWith(keyPath, key);
  });

  it('reuses the existing key on subsequent runs', async () => {
    const existing = new Uint8Array(VAULT_KEY_BYTES).fill(0x99);
    const fs = makeFs({ [keyPath]: existing });

    const key = await ensureVaultKey({ keyPath, fs, randomBytes });

    expect(Array.from(key)).toEqual(Array.from(existing));
    expect(randomBytes).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('throws when the key file is the wrong size (rather than silently regenerating)', async () => {
    const fs = makeFs({ [keyPath]: new Uint8Array(16) });

    await expect(ensureVaultKey({ keyPath, fs, randomBytes })).rejects.toThrow(
      /vault key/i,
    );
  });

  it('propagates non-not-found read errors instead of regenerating', async () => {
    const fs = makeFs();
    fs.readFile.mockRejectedValueOnce(new Error('permission denied'));

    await expect(ensureVaultKey({ keyPath, fs, randomBytes })).rejects.toThrow(
      /permission denied/,
    );
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});
