import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { AuthError, type AuthSession, type EndlesssClient } from '@hoppper/sdk';

export type SessionClient = Pick<EndlesssClient, 'login' | 'logout' | 'getSession'>;

export function defineSessionStore(client: SessionClient) {
  return defineStore('session', () => {
    const session = ref<AuthSession | null>(null);
    const authError = ref<string | null>(null);
    const isAuthenticated = computed(() => session.value !== null);

    async function login(username: string, password: string): Promise<void> {
      try {
        session.value = await client.login(username, password);
        authError.value = null;
      } catch (err) {
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
