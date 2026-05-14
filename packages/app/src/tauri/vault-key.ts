export const VAULT_KEY_BYTES = 32;

export interface VaultKeyFs {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
}

export interface EnsureVaultKeyOptions {
  keyPath: string;
  fs: VaultKeyFs;
  randomBytes: (n: number) => Uint8Array;
}

// Reads the per-install vault key from `keyPath`, generating it on first run.
// The file holds exactly VAULT_KEY_BYTES bytes; a different size is treated as
// corruption and surfaces as an error rather than being silently overwritten.
export async function ensureVaultKey(opts: EnsureVaultKeyOptions): Promise<Uint8Array> {
  let existing: Uint8Array | null = null;
  try {
    existing = await opts.fs.readFile(opts.keyPath);
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }

  if (existing) {
    if (existing.byteLength !== VAULT_KEY_BYTES) {
      throw new Error(
        `vault key at ${opts.keyPath} has wrong size (${existing.byteLength} bytes; expected ${VAULT_KEY_BYTES})`,
      );
    }
    return existing;
  }

  const generated = opts.randomBytes(VAULT_KEY_BYTES);
  await opts.fs.writeFile(opts.keyPath, generated);
  return generated;
}

function isNotFound(err: unknown): boolean {
  const msg = typeof err === 'string' ? err : (err as { message?: string } | null)?.message;
  if (!msg) return false;
  return (
    msg.includes('not found') ||
    msg.includes('No such file') ||
    msg.includes('os error 2') ||
    msg.includes('cannot find')
  );
}
