<template>
  <main class="perform">
    <header>
      <h1>{{ displayName }}</h1>
      <div class="status">
        <span class="state" :data-state="performance.state">{{ performance.state }}</span>
        <span v-if="performance.currentRiffId" class="current" data-test="current-riff">
          ▶ {{ performance.currentRiffId }}
        </span>
        <button
          v-if="performance.state !== 'idle'"
          type="button"
          data-test="stop"
          @click="onStop"
        >
          Stop
        </button>
      </div>
      <p v-if="performance.lastError" class="error" data-test="error">
        {{ performance.lastError }}
      </p>
    </header>

    <ul class="riffs">
      <li
        v-for="riff in currentJam.riffPage"
        :key="riff.riffId"
        :class="rowClasses(riff)"
        data-test="riff-row"
      >
        <button
          type="button"
          class="hop"
          data-test="hop"
          :disabled="hopping === riff.riffId"
          @click="onHop(riff)"
        >
          {{ hopping === riff.riffId ? '…' : 'Hop' }}
        </button>
        <span class="riff-id">{{ riff.riffId }}</span>
        <span class="riff-meta">{{ riff.bpm }} bpm</span>
        <span
          v-if="lastNotReady === riff.riffId"
          class="busy"
          data-test="busy-badge"
        >
          buffering…
        </span>
      </li>
    </ul>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { RiffCouchID, RiffDocument } from '@hoppper/sdk';
import {
  useCurrentJamStore,
  useJamsStore,
  usePerformanceStore,
} from '../stores';

const route = useRoute();
const jamsStore = useJamsStore();
const currentJam = useCurrentJamStore();
const performance = usePerformanceStore();

const jamId = computed(() => String(route.params.jamId));
const profile = computed(() => jamsStore.profilesById.get(jamId.value));
const displayName = computed(() => profile.value?.displayName ?? jamId.value);

const hopping = ref<RiffCouchID | null>(null);
const lastNotReady = ref<RiffCouchID | null>(null);

onMounted(async () => {
  await Promise.all([
    jamsStore.loadProfile(jamId.value),
    currentJam.open(jamId.value),
  ]);
});

onUnmounted(() => {
  performance.stop();
  currentJam.close();
});

async function onHop(riff: RiffDocument): Promise<void> {
  hopping.value = riff.riffId;
  lastNotReady.value = null;
  try {
    const result = await performance.hopTo(jamId.value, riff);
    if (result.kind === 'not-ready') {
      lastNotReady.value = riff.riffId;
    }
  } finally {
    hopping.value = null;
  }
}

function onStop(): void {
  performance.stop();
}

function rowClasses(riff: RiffDocument): Record<string, boolean> {
  return {
    'riff-row': true,
    current: performance.currentRiffId === riff.riffId,
  };
}
</script>

<style scoped>
.perform {
  max-width: 48rem;
  margin: 2rem auto;
  font-family: system-ui, sans-serif;
}
header {
  margin-bottom: 1rem;
}
.status {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-top: 0.5rem;
}
.state {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  background: #f0f0f0;
}
.state[data-state='playing'] {
  background: #e6f7e6;
  color: #1a6e1a;
}
.current {
  font-family: ui-monospace, monospace;
}
.error {
  color: #b00020;
  font-size: 0.875rem;
}
.riffs {
  list-style: none;
  padding: 0;
  margin: 0;
}
.riff-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid #eee;
}
.riff-row.current {
  background: #fafffa;
}
.hop {
  min-width: 3.5rem;
}
.riff-id {
  font-family: ui-monospace, monospace;
  flex: 1;
}
.riff-meta {
  color: #666;
  font-size: 0.875rem;
}
.busy {
  color: #b87a00;
  font-size: 0.75rem;
}
</style>
