<template>
  <main class="jam-detail">
    <header>
      <router-link to="/jams" class="back-link" data-test="back-link">
        ← Jams
      </router-link>
      <h1>{{ displayName }}</h1>
      <p v-if="profile?.bio" class="bio">{{ profile.bio }}</p>
      <router-link
        :to="{ name: 'perform', params: { jamId } }"
        data-test="perform-link"
        class="perform-link"
      >
        Perform →
      </router-link>
    </header>
    <ul class="riffs">
      <li
        v-for="riff in currentJam.riffPage"
        :key="riff.riffId"
        data-test="riff-row"
        class="riff-row"
      >
        <span class="riff-id">{{ riff.riffId }}</span>
        <span class="riff-meta">{{ activeSlotCount(riff) }}/8 · {{ riff.bpm }} bpm</span>
      </li>
    </ul>
    <button
      v-if="currentJam.hasMore"
      type="button"
      data-test="load-more"
      :disabled="loadingMore"
      @click="onLoadMore"
    >
      {{ loadingMore ? 'Loading…' : 'Load more' }}
    </button>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useCurrentJamStore, useJamsStore } from '../stores';
import type { RiffDocument } from '@hoppper/sdk';

const route = useRoute();
const jamsStore = useJamsStore();
const currentJam = useCurrentJamStore();
const loadingMore = ref(false);

const jamId = computed(() => String(route.params.jamId));
const profile = computed(() => jamsStore.profilesById.get(jamId.value));
const displayName = computed(() => profile.value?.displayName ?? jamId.value);

onMounted(async () => {
  await Promise.all([jamsStore.loadProfile(jamId.value), currentJam.open(jamId.value)]);
});

onUnmounted(() => {
  currentJam.close();
});

async function onLoadMore(): Promise<void> {
  loadingMore.value = true;
  try {
    await currentJam.loadNextPage();
  } finally {
    loadingMore.value = false;
  }
}

function activeSlotCount(riff: Pick<RiffDocument, 'slots'>): number {
  return riff.slots.filter((s) => s.on).length;
}
</script>

<style scoped>
.jam-detail {
  max-width: 48rem;
  margin: 2rem auto;
  font-family: system-ui, sans-serif;
}
header {
  margin-bottom: 1rem;
}
.bio {
  color: #666;
  margin: 0.25rem 0 0;
}
.perform-link {
  display: inline-block;
  margin-top: 0.5rem;
  font-weight: 600;
  text-decoration: none;
}
.back-link {
  display: inline-block;
  margin-bottom: 0.5rem;
  color: #555;
  text-decoration: none;
  font-size: 0.875rem;
}
.back-link:hover {
  text-decoration: underline;
}
.riffs {
  list-style: none;
  padding: 0;
  margin: 0;
}
.riff-row {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid #eee;
}
.riff-id {
  font-family: ui-monospace, monospace;
}
.riff-meta {
  color: #666;
  font-size: 0.875rem;
}
button {
  margin-top: 1rem;
}
</style>
