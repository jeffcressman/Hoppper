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
      <button type="submit" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
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
</style>
