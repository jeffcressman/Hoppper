<template>
  <button
    v-if="session.isAuthenticated || loggingOut"
    type="button"
    class="logout"
    data-test="logout"
    :disabled="loggingOut"
    @click="onLogout"
  >
    {{ loggingOut ? 'Logging out…' : 'Log out' }}
  </button>
  <RouterView />
  <LogPanel />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { RouterView, useRouter } from 'vue-router';
import LogPanel from './views/LogPanel.vue';
import { useSessionStore } from './stores';

const session = useSessionStore();
const router = useRouter();
const loggingOut = ref(false);

async function onLogout(): Promise<void> {
  loggingOut.value = true;
  try {
    // session.logout() clears the in-memory state synchronously, so
    // the router guard sees us as unauthenticated immediately. The
    // disk persist (Stronghold save, slow) finishes in the background.
    const done = session.logout();
    await router.push('/login');
    await done;
  } finally {
    loggingOut.value = false;
  }
}
</script>

<style scoped>
.logout {
  position: fixed;
  top: 0.75rem;
  right: 0.75rem;
  z-index: 10;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 0.25rem 0.75rem;
  font-size: 0.8125rem;
  cursor: pointer;
  font-family: system-ui, sans-serif;
}
.logout:hover {
  background: #f5f5f5;
}
</style>
