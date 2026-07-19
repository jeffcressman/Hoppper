<template>
  <main class="perform">
    <header>
      <router-link
        :to="{ name: 'jam-detail', params: { jamId } }"
        class="back-link"
        data-test="back-link"
      >
        ← {{ displayName }}
      </router-link>
      <h1>{{ displayName }} — Perform</h1>
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
        <button
          v-if="!recorder.isRecording"
          type="button"
          class="record"
          data-test="record"
          @click="onRecord"
        >
          ● Record
        </button>
        <button
          v-else
          type="button"
          class="record recording"
          data-test="stop-recording"
          @click="onStopRecording"
        >
          ■ Stop Recording
        </button>
        <span
          v-if="recorder.isRecording"
          class="rec-clock"
          data-test="recording-elapsed"
        >
          {{ formatDuration(recordingElapsed) }}
        </span>
      </div>
      <p v-if="performance.lastError" class="error" data-test="error">
        {{ performance.lastError }}
      </p>
    </header>

    <section v-if="recorder.saved.length > 0" class="saved">
      <h2>Saved sequences</h2>
      <ul>
        <li
          v-for="seq in recorder.saved"
          :key="seq.id"
          class="saved-row"
          data-test="saved-row"
        >
          <button
            type="button"
            data-test="play-saved"
            :disabled="recorder.isPlaying"
            @click="recorder.play(seq)"
          >
            ▶ Play
          </button>
          <span class="saved-title">{{ seq.title }}</span>
          <span class="saved-duration" data-test="saved-duration">
            {{ formatDuration(seq.durationSec) }}
          </span>
          <button
            type="button"
            class="delete"
            data-test="delete-saved"
            @click="recorder.delete(seq.jamId, seq.id)"
          >
            🗑
          </button>
        </li>
      </ul>
    </section>

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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { RiffCouchID, RiffDocument } from '@hoppper/sdk';
import {
  useCurrentJamStore,
  useJamsStore,
  usePerformanceStore,
  useRecorderStore,
} from '../stores';

const route = useRoute();
const jamsStore = useJamsStore();
const currentJam = useCurrentJamStore();
const performance = usePerformanceStore();
const recorder = useRecorderStore();

const jamId = computed(() => String(route.params.jamId));
const profile = computed(() => jamsStore.profilesById.get(jamId.value));
const displayName = computed(() => profile.value?.displayName ?? jamId.value);

const hopping = ref<RiffCouchID | null>(null);
const lastNotReady = ref<RiffCouchID | null>(null);
const recordingElapsed = ref(0);
let recordStartedAtMs = 0;
let recordingTimer: number | null = null;

watch(
  () => recorder.isRecording,
  (isRecording) => {
    if (isRecording) {
      recordStartedAtMs = Date.now();
      recordingElapsed.value = 0;
      recordingTimer = window.setInterval(() => {
        recordingElapsed.value = (Date.now() - recordStartedAtMs) / 1000;
      }, 250);
    } else if (recordingTimer !== null) {
      window.clearInterval(recordingTimer);
      recordingTimer = null;
    }
  },
  { immediate: true },
);

onMounted(async () => {
  await Promise.all([
    jamsStore.loadProfile(jamId.value),
    currentJam.open(jamId.value),
    recorder.loadSaved(jamId.value),
  ]);
});

onUnmounted(() => {
  performance.stop();
  if (recorder.isPlaying) recorder.stopPlayback();
  if (recordingTimer !== null) window.clearInterval(recordingTimer);
  currentJam.close();
});

function onRecord(): void {
  recorder.start(jamId.value);
}

async function onStopRecording(): Promise<void> {
  await recorder.stop();
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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
.record.recording {
  color: #b00020;
}
.rec-clock {
  font-family: ui-monospace, monospace;
  color: #b00020;
  font-variant-numeric: tabular-nums;
}
.saved {
  margin: 1rem 0;
}
.saved h2 {
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #555;
  margin: 0 0 0.5rem;
}
.saved ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.saved-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.375rem 0;
  border-bottom: 1px solid #eee;
}
.saved-title {
  flex: 1;
}
.saved-duration {
  font-family: ui-monospace, monospace;
  color: #666;
  font-variant-numeric: tabular-nums;
}
.saved .delete {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 1rem;
  padding: 0.25rem 0.5rem;
}
.saved .delete:hover {
  background: #f8f8f8;
  border-radius: 4px;
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
