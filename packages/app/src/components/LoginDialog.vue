<template>
  <div class="lw-dialog__scrim" @mousedown.self="cancel">
    <form
      class="lw-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-title"
      style="--dlg-w: 420px"
      @submit.prevent="onSubmit"
    >
      <div class="lw-dialog__head">
        <div id="login-title" class="lw-dialog__title">Log in to Endlesss</div>
      </div>
      <div class="lw-dialog__body">
        <label class="lw-field">
          <span class="lw-field__label">Username</span>
          <input
            v-model="username"
            class="lw-input"
            name="username"
            autocomplete="username"
            required
            :disabled="busy"
          />
        </label>
        <label class="lw-field">
          <span class="lw-field__label">Password</span>
          <input
            v-model="password"
            class="lw-input"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            :disabled="busy"
          />
        </label>
        <p v-if="session.authError" class="lw-field__hint lw-field__hint--error" role="alert">
          {{ session.authError }}
        </p>
        <p v-if="busy" class="lw-field__hint" aria-live="polite">
          Endlesss can take 20–60 seconds to respond. Hold tight.
        </p>
      </div>
      <div class="lw-dialog__foot">
        <button
          type="button"
          class="lw-btn lw-btn--ghost"
          data-test="login-cancel"
          :disabled="busy"
          @click="cancel"
        >
          Cancel
        </button>
        <button type="submit" class="lw-btn lw-btn--primary" :disabled="busy">
          <span v-if="busy" class="spinner" data-test="login-spinner" aria-hidden="true" />
          {{ busy ? 'Logging in…' : 'Log in' }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useSessionStore } from '../stores';
import { log } from '../logging/log-store';

const emit = defineEmits<{ close: [] }>();
const session = useSessionStore();

const username = ref('');
const password = ref('');
const busy = ref(false);

function cancel(): void {
  if (!busy.value) emit('close');
}

async function onSubmit(): Promise<void> {
  busy.value = true;
  log('info', 'login', `submitting login for user=${username.value}`);
  try {
    await session.login(username.value, password.value);
    if (session.authError) log('warn', 'login', `auth error: ${session.authError}`);
    if (session.isAuthenticated) {
      log('info', 'login', 'logged in');
      emit('close');
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
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
