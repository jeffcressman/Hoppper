<template>
  <div class="lw-view">
    <div class="lw-view__head">
      <div>
        <h1 class="lw-view__title">Public Jams</h1>
        <p class="lw-view__sub">{{ subtitle }}</p>
      </div>
      <button
        v-if="!session.isAuthenticated"
        type="button"
        class="lw-btn lw-btn--primary"
        @click="loginOpen = true"
      >
        Log in
      </button>
    </div>

    <LoginGate
      v-if="!session.isAuthenticated"
      title="Log in to see public jams"
      body="Hoppper uses your Endlesss account. Once you’re in, pick any jam to start hopping."
      @login="loginOpen = true"
    />
    <p v-else-if="!jamsStore.listing" class="lw-view__sub">Loading jams…</p>
    <div v-else class="jam-grid">
      <JamTile
        v-for="jam in jams"
        :key="jam.jamId"
        :title="jam.title"
        :meta="jam.meta"
        :jam-id="jam.jamId"
        :current="jam.jamId === currentJam.lastJamId"
        @open="open(jam.jamId)"
      />
    </div>

    <LoginDialog v-if="loginOpen" @close="loginOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useCurrentJamStore, useJamsStore, useSessionStore } from '../stores';
import JamTile from '../components/JamTile.vue';
import LoginGate from '../components/LoginGate.vue';
import LoginDialog from '../components/LoginDialog.vue';

const session = useSessionStore();
const jamsStore = useJamsStore();
const currentJam = useCurrentJamStore();
const router = useRouter();
const loginOpen = ref(false);

// The store keeps the CouchDB view's oldest-first order; the page shows newest first.
const jams = computed(() =>
  [...(jamsStore.listing?.joinable ?? [])].reverse().map((ref) => {
    const profile = jamsStore.profilesById.get(ref.jamId);
    return { jamId: ref.jamId, title: profile?.displayName ?? ref.jamId, meta: profile?.bio };
  }),
);

const subtitle = computed(() => {
  if (!session.isAuthenticated) return 'Every jam on Endlesss that anyone can join';
  const n = jamsStore.listing?.joinable.length;
  return n === undefined ? '' : `${n} ${n === 1 ? 'jam' : 'jams'} open to join`;
});

// Load on arrival when logged in, or the moment the login dialog succeeds.
watch(
  () => session.isAuthenticated,
  async (authed) => {
    if (!authed) return;
    // Once a session: going back and forth between the jam pages mustn't
    // re-ask Endlesss for the same list.
    if (!jamsStore.listing) await jamsStore.refresh();
    const listed = jamsStore.listing;
    if (listed) await Promise.all(listed.joinable.map((j) => jamsStore.loadProfile(j.jamId)));
  },
  { immediate: true },
);

function open(jamId: string): void {
  void router.push({ name: 'hop-recording', params: { jamId } });
}
</script>

<style scoped>
.jam-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 26px 22px;
}
</style>
