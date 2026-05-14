import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrongholdTokenStore } from '../../src/tauri/token-store';
import type { AuthSession } from '@hoppper/sdk';

interface StubStore {
  records: Map<string, Uint8Array>;
  get: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function makeStubStore(): StubStore {
  const records = new Map<string, Uint8Array>();
  return {
    records,
    get: vi.fn(async (key: string) => records.get(key) ?? null),
    insert: vi.fn(async (key: string, value: number[]) => {
      records.set(key, new Uint8Array(value));
    }),
    remove: vi.fn(async (key: string) => {
      const v = records.get(key) ?? null;
      records.delete(key);
      return v;
    }),
  };
}

const session: AuthSession = {
  token: 'tok-abc',
  password: 'pw-xyz',
  userId: 'alice',
  expiresAt: 1_900_000_000_000,
};

let store: StubStore;
let persist: ReturnType<typeof vi.fn>;
let tokenStore: StrongholdTokenStore;

beforeEach(() => {
  store = makeStubStore();
  persist = vi.fn(async () => {});
  tokenStore = new StrongholdTokenStore({ store, persist });
});

describe('StrongholdTokenStore', () => {
  it('load() returns null when the vault has no session', async () => {
    await expect(tokenStore.load()).resolves.toBeNull();
  });

  it('save() inserts a JSON-encoded AuthSession at the "session" key', async () => {
    await tokenStore.save(session);
    expect(store.insert).toHaveBeenCalledTimes(1);
    const [key, value] = store.insert.mock.calls[0]!;
    expect(key).toBe('session');
    const decoded = JSON.parse(new TextDecoder().decode(new Uint8Array(value as number[])));
    expect(decoded).toEqual(session);
  });

  it('save() persists to disk after inserting', async () => {
    await tokenStore.save(session);
    expect(persist).toHaveBeenCalledTimes(1);
    // Persistence must come *after* the insert resolves.
    expect(store.insert.mock.invocationCallOrder[0]).toBeLessThan(
      persist.mock.invocationCallOrder[0]!,
    );
  });

  it('load() round-trips a saved session', async () => {
    await tokenStore.save(session);
    await expect(tokenStore.load()).resolves.toEqual(session);
  });

  it('load() returns null when the stored bytes are not valid JSON', async () => {
    store.records.set('session', new TextEncoder().encode('not-json{'));
    await expect(tokenStore.load()).resolves.toBeNull();
  });

  it('clear() removes the session record and persists', async () => {
    await tokenStore.save(session);
    persist.mockClear();
    await tokenStore.clear();

    expect(store.remove).toHaveBeenCalledWith('session');
    await expect(tokenStore.load()).resolves.toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('clear() is safe to call on an empty vault', async () => {
    await expect(tokenStore.clear()).resolves.toBeUndefined();
    expect(store.remove).toHaveBeenCalledWith('session');
  });
});
