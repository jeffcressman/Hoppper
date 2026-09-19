<template>
  <div class="lw-view">
    <div class="lw-view__head">
      <h1 class="lw-view__title">Settings</h1>
    </div>

    <section class="panel">
      <span class="lwlkc-eyebrow">Endlesss account</span>
      <div v-if="session.isAuthenticated || loggingOut" class="panel__row">
        <span class="avatar" aria-hidden="true">{{ initial }}</span>
        <div class="panel__who">
          <div class="panel__name">{{ session.session?.userId }}</div>
          <div class="panel__note">Logged in</div>
        </div>
        <button
          type="button"
          class="lw-btn lw-btn--secondary"
          data-test="logout"
          :disabled="loggingOut"
          @click="onLogout"
        >
          <LwIcon name="logout" />
          {{ loggingOut ? 'Logging out…' : 'Log out' }}
        </button>
      </div>
      <div v-else class="panel__row">
        <div class="panel__who panel__note">You’re not logged in.</div>
        <button type="button" class="lw-btn lw-btn--primary" data-test="login" @click="loginOpen = true">
          Log in
        </button>
      </div>
    </section>

    <LoginDialog v-if="loginOpen" @close="loginOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useCurrentJamStore, useJamsStore, useSessionStore } from '../stores';
import LwIcon from '../components/LwIcon.vue';
import LoginDialog from '../components/LoginDialog.vue';

const session = useSessionStore();
const jamsStore = useJamsStore();
const currentJam = useCurrentJamStore();
const router = useRouter();
const loggingOut = ref(false);
const loginOpen = ref(false);

const initial = computed(() => (session.session?.userId ?? '?').charAt(0).toUpperCase());

async function onLogout(): Promise<void> {
  loggingOut.value = true;
  try {
    // session.logout() clears the in-memory state synchronously, so the
    // pages see a logged-out user at once. The disk persist (Stronghold
    // save, slow) finishes in the background.
    const done = session.logout();
    // The jam list and the last jam opened were that user's.
    jamsStore.clear();
    currentJam.forget();
    await router.push({ name: 'public-jams' });
    await done;
  } finally {
    loggingOut.value = false;
  }
}
</script>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 640px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface-1);
}
.panel__row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.panel__who {
  flex: 1;
  min-width: 0;
}
.panel__name {
  font-weight: 700;
  color: var(--text-1);
}
.panel__note {
  font-size: var(--text-sm);
  color: var(--text-3);
}
/* Avatar (layout/Avatar), initials form */
.avatar {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--surface-3);
  color: var(--text-1);
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 16px;
}
</style>
