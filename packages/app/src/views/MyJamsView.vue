<template>
  <div class="lw-view">
    <div class="lw-view__head">
      <div>
        <h1 class="lw-view__title">My Jams</h1>
        <p class="lw-view__sub">{{ subtitle }}</p>
      </div>
    </div>

    <LoginGate
      v-if="!session.isAuthenticated"
      title="Log in to see your jams"
      body="Your personal jam and every jam you’ve joined on Endlesss show up here."
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
        :personal="jam.personal"
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
import type { JamRef } from '@hoppper/sdk';
import { useCurrentJamStore, useJamsStore, useSessionStore } from '../stores';
import JamTile from '../components/JamTile.vue';
import LoginGate from '../components/LoginGate.vue';
import LoginDialog from '../components/LoginDialog.vue';
import { formatDay } from '../ui/format';

const session = useSessionStore();
const jamsStore = useJamsStore();
const currentJam = useCurrentJamStore();
const router = useRouter();
const loginOpen = ref(false);

// My Jams is the old Personal and Subscribed lists together: the personal jam
// first, then joined jams newest first (the store keeps the view's oldest-first
// order).
const mine = computed<JamRef[]>(() => {
  const listed = jamsStore.listing;
  return listed ? [listed.personal, ...[...listed.subscribed].reverse()] : [];
});

const jams = computed(() =>
  mine.value.map((ref) => {
    const personal = ref.category === 'personal';
    return {
      jamId: ref.jamId,
      personal,
      title: jamsStore.profilesById.get(ref.jamId)?.displayName ?? ref.jamId,
      meta: personal
        ? 'Your personal jam'
        : ref.joinedAt
          ? `Joined ${formatDay(ref.joinedAt)}`
          : undefined,
    };
  }),
);

const subtitle = computed(() => {
  const joined = jamsStore.listing?.subscribed.length;
  if (!session.isAuthenticated || joined === undefined) {
    return 'Your personal jam and the jams you’ve joined';
  }
  return `Your personal jam and the ${joined} ${joined === 1 ? 'jam' : 'jams'} you’ve joined`;
});

watch(
  () => session.isAuthenticated,
  async (authed) => {
    if (!authed) return;
    // Once a session: going back and forth between the jam pages mustn't
    // re-ask Endlesss for the same list.
    if (!jamsStore.listing) await jamsStore.refresh();
    await Promise.all(mine.value.map((j) => jamsStore.loadProfile(j.jamId)));
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
