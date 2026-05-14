import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { defineSessionStore, type SessionClient } from '../../src/stores/session';
import { AuthError, type AuthSession } from '@hoppper/sdk';

const session: AuthSession = {
  token: 'tok',
  password: 'pw',
  userId: 'alice',
  expiresAt: Date.now() + 10_000_000,
};

function makeStub(overrides: Partial<SessionClient> = {}): SessionClient {
  return {
    login: vi.fn(async () => session),
    logout: vi.fn(async () => {}),
    getSession: vi.fn(async () => null),
    ...overrides,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('useSessionStore', () => {
  it('starts with no session and no auth error', () => {
    const useStore = defineSessionStore(makeStub());
    const store = useStore();
    expect(store.session).toBeNull();
    expect(store.authError).toBeNull();
    expect(store.isAuthenticated).toBe(false);
  });

  it('login populates session and isAuthenticated', async () => {
    const client = makeStub();
    const useStore = defineSessionStore(client);
    const store = useStore();

    await store.login('alice', 'hunter2');
    expect(client.login).toHaveBeenCalledWith('alice', 'hunter2');
    expect(store.session).toEqual(session);
    expect(store.isAuthenticated).toBe(true);
  });

  it('logout clears session and isAuthenticated', async () => {
    const client = makeStub();
    const useStore = defineSessionStore(client);
    const store = useStore();
    await store.login('alice', 'hunter2');

    await store.logout();
    expect(client.logout).toHaveBeenCalled();
    expect(store.session).toBeNull();
    expect(store.isAuthenticated).toBe(false);
  });

  it('hydrate pulls a persisted session from the client', async () => {
    const client = makeStub({ getSession: vi.fn(async () => session) });
    const useStore = defineSessionStore(client);
    const store = useStore();

    await store.hydrate();
    expect(store.session).toEqual(session);
  });

  it('AuthError in login surfaces as authError, leaves session null', async () => {
    const client = makeStub({
      login: vi.fn(async () => {
        throw new AuthError('bad password');
      }),
    });
    const useStore = defineSessionStore(client);
    const store = useStore();

    await store.login('alice', 'wrong');
    expect(store.session).toBeNull();
    expect(store.authError).toBe('bad password');
    expect(store.isAuthenticated).toBe(false);
  });

  it('a successful login clears a prior authError', async () => {
    let calls = 0;
    const client = makeStub({
      login: vi.fn(async () => {
        calls++;
        if (calls === 1) throw new AuthError('bad password');
        return session;
      }),
    });
    const useStore = defineSessionStore(client);
    const store = useStore();

    await store.login('alice', 'wrong');
    expect(store.authError).toBe('bad password');
    await store.login('alice', 'correct');
    expect(store.authError).toBeNull();
    expect(store.session).toEqual(session);
  });

  it('non-auth errors in login rethrow and do not silently absorb', async () => {
    const client = makeStub({
      login: vi.fn(async () => {
        throw new Error('network down');
      }),
    });
    const useStore = defineSessionStore(client);
    const store = useStore();

    await expect(store.login('a', 'b')).rejects.toThrow(/network down/);
    expect(store.session).toBeNull();
  });
});
