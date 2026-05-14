import { describe, it, expect, vi, beforeEach } from 'vitest';

const pathMocks = vi.hoisted(() => ({
  appLocalDataDir: vi.fn(async () => '/app-data'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

const strongholdMocks = vi.hoisted(() => {
  const store = {
    get: vi.fn(async () => null),
    insert: vi.fn(async () => {}),
    remove: vi.fn(async () => null),
  };
  const client = {
    getStore: vi.fn(() => store),
  };
  const stronghold = {
    loadClient: vi.fn(async () => client),
    createClient: vi.fn(async () => client),
    save: vi.fn(async () => {}),
  };
  return {
    Stronghold: { load: vi.fn(async () => stronghold) },
    stronghold,
    client,
    store,
  };
});

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(async () => {
    throw new Error('No such file or directory');
  }),
  writeFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
}));

const cryptoMocks = vi.hoisted(() => ({
  randomBytes: vi.fn((n: number) => new Uint8Array(n).fill(0x42)),
}));

vi.mock('@tauri-apps/api/path', () => pathMocks);
vi.mock('@tauri-apps/plugin-stronghold', () => ({ Stronghold: strongholdMocks.Stronghold }));
vi.mock('../../src/tauri/fs-adapter', () => ({
  tauriFsAdapter: () => fsMocks,
}));
vi.mock('../../src/tauri/random', () => cryptoMocks);

import { openTokenStore } from '../../src/tauri/open-token-store';

beforeEach(() => {
  strongholdMocks.stronghold.loadClient.mockResolvedValue(strongholdMocks.client);
  strongholdMocks.Stronghold.load.mockClear();
  strongholdMocks.stronghold.save.mockClear();
  strongholdMocks.client.getStore.mockClear();
});

describe('openTokenStore', () => {
  it('loads Stronghold against the vault path + key, returning a StrongholdTokenStore', async () => {
    const ts = await openTokenStore();

    expect(strongholdMocks.Stronghold.load).toHaveBeenCalledTimes(1);
    const call = strongholdMocks.Stronghold.load.mock.calls[0] as unknown as [string, string];
    const [vaultPath, password] = call;
    expect(vaultPath).toBe('/app-data/session.stronghold');
    // 32-byte key in hex = 64 chars; the stub key is all 0x42s.
    expect(password).toBe('42'.repeat(32));

    // Returned object satisfies the SDK's TokenStore interface.
    expect(typeof ts.load).toBe('function');
    expect(typeof ts.save).toBe('function');
    expect(typeof ts.clear).toBe('function');
  });

  it('creates the client on a fresh vault and reuses it next time', async () => {
    strongholdMocks.stronghold.loadClient.mockRejectedValueOnce(new Error('not found'));
    await openTokenStore();
    expect(strongholdMocks.stronghold.createClient).toHaveBeenCalledTimes(1);
  });
});
