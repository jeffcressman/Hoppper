import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { Stronghold } from '@tauri-apps/plugin-stronghold';
import { StrongholdTokenStore } from './token-store';
import { tauriFsAdapter } from './fs-adapter';
import { ensureVaultKey } from './vault-key';
import { randomBytes } from './random';

const CLIENT_NAME = 'hoppper';

export async function openTokenStore(): Promise<StrongholdTokenStore> {
  const appData = await appLocalDataDir();
  const vaultPath = await join(appData, 'session.stronghold');
  const keyPath = await join(appData, 'vault.key');

  const fs = tauriFsAdapter();
  // First-run installs land here before the OS-managed app-data directory
  // exists. Tauri's writeFile does not create parents, so neither
  // ensureVaultKey nor Stronghold.load can write through to disk without
  // this. Recursive + idempotent — cheap to run every boot.
  await fs.mkdir(appData, { recursive: true });
  const key = await ensureVaultKey({ keyPath, fs, randomBytes });

  // Stronghold takes a string password; hex-encode the 32 bytes so the same
  // key file produces the same password deterministically across runs.
  const password = toHex(key);
  const stronghold = await Stronghold.load(vaultPath, password);

  let client;
  try {
    client = await stronghold.loadClient(CLIENT_NAME);
  } catch {
    client = await stronghold.createClient(CLIENT_NAME);
  }
  const store = client.getStore();

  return new StrongholdTokenStore({
    store,
    persist: () => stronghold.save(),
  });
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
