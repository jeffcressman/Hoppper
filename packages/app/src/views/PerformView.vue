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

    <div class="rec">
      <div class="rec__journal">
        <RiffJournal
          :jam-id="jamId"
          :riffs="currentJam.riffPage"
          :current-riff-id="performance.currentRiffId"
          :loading-ids="loading"
          :not-ready-id="lastNotReady"
          @hop="onHop"
        />
        <button
          v-if="currentJam.hasMore"
          type="button"
          class="lw-btn lw-btn--ghost lw-btn--sm"
          data-test="load-more"
          :disabled="loadingMore"
          @click="onLoadMore"
        >
          {{ loadingMore ? 'Loading…' : 'Load more' }}
        </button>
      </div>

      <!-- The mixer and waveform take this column in Slice B; until then it
           holds the recording controls and this jam's takes. -->
      <div class="rec__deck">
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
      </div>
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
import RiffJournal from '../components/RiffJournal.vue';
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

</script>

<style scoped>
/* Hop Recording layout (design canvas): the jam's rifff history on the left,
   the deck on the right. */
.perform {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.strip {
  flex: none;
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
.rec {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 372px minmax(0, 1fr);
}
.rec__journal {
  min-height: 0;
  overflow: auto;
  padding: 16px 20px 24px;
  background: var(--bg-sunken);
  border-right: 1px solid var(--line);
}
.rec__deck {
  min-height: 0;
  overflow: auto;
  padding: 20px 24px;
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
.saved h2 {
  margin-bottom: 8px;
}
.saved ul {
  list-style: none;
  padding: 0;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface-1);
}
.saved-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-top: 1px solid var(--line-faint);
}
.saved-row:first-child {
  border-top: none;
}
.saved-row.playing {
  background: var(--accent-soft);
}
.saved-title {
  flex: 1;
  color: var(--text-1);
}
.saved-duration {
  font-size: var(--text-sm);
  color: var(--text-3);
}
.saved .delete:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
</style>
