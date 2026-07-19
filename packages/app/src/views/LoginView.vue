<template>
  <main class="login">
    <h1>Hoppper</h1>
    <form @submit.prevent="onSubmit">
      <label>
        Username
        <input v-model="username" name="username" autocomplete="username" required />
      </label>
      <label>
        Password
        <input
          v-model="password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </label>
      <p v-if="session.authError" class="auth-error" role="alert">{{ session.authError }}</p>
      <button type="submit" :disabled="busy">
        <span v-if="busy" class="spinner" data-test="login-spinner" aria-hidden="true" />
        <span>{{ busy ? 'Signing in…' : 'Sign in' }}</span>
      </button>
      <p v-if="busy" class="hint" aria-live="polite">
        Endlesss can take 20–60 seconds to respond. Hold tight.
      </p>
    </form>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../stores';
import { log } from '../logging/log-store';

const session = useSessionStore();
const router = useRouter();

const username = ref('');
const password = ref('');
const busy = ref(false);

async function onSubmit() {
  busy.value = true;
  log('info', 'login', `submitting login for user=${username.value}`);
  try {
    await session.login(username.value, password.value);
    log('info', 'login', `session.login returned (authenticated=${session.isAuthenticated})`);
    if (session.authError) {
      log('warn', 'login', `auth error: ${session.authError}`);
    }
    if (session.isAuthenticated) {
      log('debug', 'login', 'pushing /jams');
      await router.push('/jams');
      log('info', 'login', 'navigated to /jams');
    }
  } catch (err) {
    log('error', 'login', err instanceof Error ? err.message : String(err), err);
    throw err;
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.login {
  max-width: 24rem;
  margin: 4rem auto;
  font-family: system-ui, sans-serif;
}
form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.auth-error {
  color: #c33;
  margin: 0;
}
.hint {
  color: #666;
  font-size: 0.8125rem;
  margin: 0;
}
button[type='submit'] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
}
.spinner {
  width: 0.875rem;
  height: 0.875rem;
  border: 2px solid #ccc;
  border-top-color: #555;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
