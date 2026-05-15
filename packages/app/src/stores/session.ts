import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { AuthError, type AuthSession, type EndlesssClient } from '@hoppper/sdk';
import { log } from '../logging/log-store';

export type SessionClient = Pick<EndlesssClient, 'login' | 'logout' | 'getSession'>;

export function defineSessionStore(client: SessionClient) {
  return defineStore('session', () => {
    const session = ref<AuthSession | null>(null);
    const authError = ref<string | null>(null);
    const isAuthenticated = computed(() => session.value !== null);

    async function login(username: string, password: string): Promise<void> {
      try {
        log('debug', 'session', 'calling client.login');
        const result = await client.login(username, password);
        log('debug', 'session', `client.login resolved; userId=${result.userId}`);
        session.value = result;
        log('debug', 'session', 'session.value assigned; clearing authError');
        authError.value = null;
      } catch (err) {
        log('warn', 'session', `client.login threw: ${err instanceof Error ? err.message : String(err)}`);
        if (err instanceof AuthError) {
          authError.value = err.message;
          session.value = null;
          return;
        }
        throw err;
      }
    }

    async function logout(): Promise<void> {
      await client.logout();
      session.value = null;
      authError.value = null;
    }

    async function hydrate(): Promise<void> {
      session.value = await client.getSession();
    }

    return { session, authError, isAuthenticated, login, logout, hydrate };
  });
}
