<template>
  <div class="perform">
    <div class="strip">
      <div class="strip__title">
        <span class="lwlkc-eyebrow">Jam</span>
        <h1 class="strip__name">{{ displayName }}</h1>
      </div>
      <span v-if="performance.currentRiffId" class="strip__meta lwlkc-readout" data-test="current-riff">
        ▶ {{ performance.currentRiffId }}
      </span>
    </div>

    <div class="lw-view">
      <div class="controls">
        <span class="lw-badge" :class="{ 'lw-badge--success': performance.state === 'playing' }" :data-state="performance.state">
          {{ performance.state }}
        </span>
        <button
          v-if="performance.state !== 'idle' || recorder.isPlaying"
          type="button"
          class="lw-btn lw-btn--secondary lw-btn--sm"
          data-test="stop"
          @click="onStop"
        >
          <LwIcon name="stop" />
          Stop
        </button>
        <button
          v-if="!recorder.isRecording"
          type="button"
          class="lw-btn lw-btn--danger lw-btn--sm"
          data-test="record"
          @click="onRecord"
        >
          <LwIcon name="record" />
          Record
        </button>
        <button
          v-else
          type="button"
          class="lw-btn lw-btn--secondary lw-btn--sm recording"
          data-test="stop-recording"
          @click="onStopRecording"
        >
          <LwIcon name="stop" />
          Stop Recording
        </button>
        <span v-if="recorder.isArmed" class="lw-badge lw-badge--danger lw-badge--dot" data-test="recording-waiting">
          Waiting for first rifff…
        </span>
        <span
          v-else-if="recorder.isRecording"
          class="rec-clock lwlkc-readout"
          data-test="recording-elapsed"
        >
          {{ formatDuration(recordingElapsed) }}
        </span>
        <label class="quantise" title="Hold each hop until the next beat">
          <input
            v-model="performance.quantiseEntry"
            type="checkbox"
            data-test="quantise-entry"
          />
          Quantise hops to the beat
        </label>
      </div>
      <p v-if="performance.lastError" class="error" data-test="error">
        {{ performance.lastError }}
      </p>

      <section v-if="recorder.saved.length > 0" class="saved">
        <h2 class="lwlkc-eyebrow">Saved sequences</h2>
        <ul>
          <li
            v-for="seq in recorder.saved"
            :key="seq.id"
            :class="['saved-row', { playing: recorder.playingId === seq.id }]"
            data-test="saved-row"
          >
            <button
              type="button"
              class="lw-iconbtn lw-iconbtn--solid lw-iconbtn--round lw-iconbtn--sm"
              title="Play"
              data-test="play-saved"
              :disabled="recorder.isPlaying"
              @click="recorder.play(seq)"
            >
              <LwIcon name="play" />
            </button>
            <span class="saved-title">{{ seq.title }}</span>
            <span class="saved-duration lwlkc-readout" data-test="saved-duration">
              {{ formatDuration(seq.durationSec) }}
            </span>
            <button
              type="button"
              class="lw-iconbtn lw-iconbtn--sm delete"
              title="Delete"
              data-test="delete-saved"
              @click="recorder.delete(seq.jamId, seq.id)"
            >
              <LwIcon name="trash" />
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
            class="lw-btn lw-btn--secondary lw-btn--sm hop"
            data-test="hop"
            :disabled="loading.has(riff.riffId)"
            @click="onHop(riff)"
          >
            Hop
          </button>
          <span class="riff-id lwlkc-readout">{{ riff.riffId }}</span>
          <span class="riff-meta">{{ riff.bpm }} bpm</span>
          <span
            v-if="lastNotReady === riff.riffId"
            class="lw-badge lw-badge--accent"
            data-test="busy-badge"
          >
            buffering…
          </span>
        </li>
      </ul>
      <button
        v-if="currentJam.hasMore"
        type="button"
        class="lw-btn lw-btn--ghost load-more"
        data-test="load-more"
        :disabled="loadingMore"
        @click="onLoadMore"
      >
        {{ loadingMore ? 'Loading…' : 'Load more' }}
      </button>
    </div>
  </div>
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
import LwIcon from '../components/LwIcon.vue';
import { formatDuration } from '../ui/format';

const route = useRoute();
const jamsStore = useJamsStore();
const currentJam = useCurrentJamStore();
const performance = usePerformanceStore();
const recorder = useRecorderStore();

const jamId = computed(() => String(route.params.jamId));
const profile = computed(() => jamsStore.profilesById.get(jamId.value));
const displayName = computed(() => profile.value?.displayName ?? jamId.value);

// Rifffs clicked and still loading. Their hop — and, while recording, the
// moment it registers — comes when loading finishes, so the row pulses until
// then. The whole row: a pulsing button alone was too easy to miss.
const loading = ref(new Set<RiffCouchID>());
const lastNotReady = ref<RiffCouchID | null>(null);
const recordingElapsed = ref(0);
let recordStartedAtMs = 0;
let recordingTimer: number | null = null;

// The take's timeline begins at the first rifff clicked, not at Record, so
// the clock waits out the armed state.
watch(
  () => recorder.isRecording && !recorder.isArmed,
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

// Every take starts at the beginning of a rifff: silence what's playing, so
// the first click after Record is a cold start on a fresh grid.
function onRecord(): void {
  stopAudio();
  recorder.start(jamId.value);
}

async function onStopRecording(): Promise<void> {
  await onStop();
}

const loadingMore = ref(false);

async function onLoadMore(): Promise<void> {
  loadingMore.value = true;
  try {
    await currentJam.loadNextPage();
  } finally {
    loadingMore.value = false;
  }
}

async function onHop(riff: RiffDocument): Promise<void> {
  loading.value.add(riff.riffId);
  lastNotReady.value = null;
  try {
    const result = await performance.hopTo(jamId.value, riff);
    if (result.kind === 'not-ready') {
      lastNotReady.value = riff.riffId;
    }
  } finally {
    loading.value.delete(riff.riffId);
  }
}

/**
 * Silence everything. A replay has its remaining hops scheduled, and stopping
 * only the engine lets the next one start the audio again.
 */
function stopAudio(): void {
  if (recorder.isPlaying) recorder.stopPlayback();
  performance.stop();
}

// Stop ends whatever is running — playback, a replay or a recording — so it
// and Stop Recording behave the same while recording.
async function onStop(): Promise<void> {
  stopAudio();
  if (recorder.isRecording) await recorder.stop();
}

function rowClasses(riff: RiffDocument): Record<string, boolean> {
  return {
    'riff-row': true,
    current: performance.currentRiffId === riff.riffId,
    loading: loading.value.has(riff.riffId),
  };
}
</script>

<style scoped>
/* A holding pattern until Slice B's Hop Recording layout replaces this page
   (docs/phases/phase-8-redesign-and-editor.md). */
.strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 48px;
  padding: 0 24px;
  border-bottom: 1px solid var(--line);
}
.strip__title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.strip__name {
  font-size: var(--text-md);
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.strip__meta {
  font-size: var(--text-xs);
  color: var(--text-3);
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 16px;
}
.quantise {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  color: var(--text-2);
  user-select: none;
  cursor: pointer;
}
.quantise input {
  accent-color: var(--accent);
}
.error {
  margin-bottom: 16px;
  color: var(--danger);
  font-size: var(--text-sm);
}
.rec-clock {
  color: var(--danger);
}
.saved {
  margin-bottom: 20px;
}
.saved h2 {
  margin-bottom: 8px;
}
.saved ul,
.riffs {
  list-style: none;
  padding: 0;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface-1);
}
.saved-row,
.riff-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-top: 1px solid var(--line-faint);
}
.saved-row:first-child,
.riff-row:first-child {
  border-top: none;
}
.saved-title {
  flex: 1;
  color: var(--text-1);
}
.saved-duration,
.riff-meta {
  font-size: var(--text-sm);
  color: var(--text-3);
}
.saved .delete:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
.riff-row.current,
.saved-row.playing {
  background: var(--accent-soft);
}
.riff-row.loading {
  animation: riff-loading 0.7s ease-in-out infinite alternate;
}
@keyframes riff-loading {
  from {
    background: var(--accent-soft);
  }
  to {
    background: var(--accent-line);
  }
}
@media (prefers-reduced-motion: reduce) {
  .riff-row.loading {
    animation: none;
    background: var(--accent-line);
  }
}
.riff-id {
  flex: 1;
  font-size: var(--text-sm);
  color: var(--text-2);
}
.load-more {
  margin-top: 12px;
}
</style>
