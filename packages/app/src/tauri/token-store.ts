import type { AuthSession, TokenStore } from '@hoppper/sdk';

// Minimal slice of @tauri-apps/plugin-stronghold's Store that the token store
// actually uses. Defined structurally so tests can supply a stub and the real
// Stronghold Store satisfies it for free.
export interface StrongholdStoreLike {
  get(key: string): Promise<Uint8Array | null>;
  insert(key: string, value: number[]): Promise<void>;
  remove(key: string): Promise<Uint8Array | null>;
}

export interface StrongholdTokenStoreOptions {
  store: StrongholdStoreLike;
  // Called after every mutation to flush the vault to disk. With the real
  // Stronghold this is `stronghold.save()`; in tests it's a no-op spy.
  persist: () => Promise<void>;
}

const SESSION_KEY = 'session';

export class StrongholdTokenStore implements TokenStore {
  private readonly store: StrongholdStoreLike;
  private readonly persist: () => Promise<void>;

  constructor(opts: StrongholdTokenStoreOptions) {
    this.store = opts.store;
    this.persist = opts.persist;
  }

  async load(): Promise<AuthSession | null> {
    const bytes = await this.store.get(SESSION_KEY);
    if (!bytes) return null;
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as AuthSession;
    } catch {
      return null;
    }
  }

  async save(session: AuthSession): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(session));
    await this.store.insert(SESSION_KEY, Array.from(bytes));
    await this.persist();
  }

  async clear(): Promise<void> {
    await this.store.remove(SESSION_KEY);
    await this.persist();
  }
}
