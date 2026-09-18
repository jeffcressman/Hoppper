<template>
  <div class="transport">
    <div class="transport__buttons">
      <button
        type="button"
        class="lw-iconbtn lw-iconbtn--solid"
        title="Stop"
        aria-label="Stop"
        :disabled="!canStop"
        data-test="stop"
        @click="onStop"
      >
        <LwIcon name="stop" />
      </button>
      <button
        type="button"
        :class="['lw-iconbtn', 'lw-iconbtn--solid', 'lw-iconbtn--round', { 'lw-iconbtn--active': playing }]"
        title="Play"
        aria-label="Play"
        :disabled="!playing && !performance.canResume"
        data-test="play"
        @click="onPlay"
      >
        <LwIcon name="play" />
      </button>
      <button
        type="button"
        :class="['lw-iconbtn', 'lw-iconbtn--solid', 'lw-iconbtn--round', 'record', { 'is-recording': recorder.isRecording }]"
        :title="recorder.isRecording ? 'Stop recording' : 'Record a hop'"
        :aria-label="recorder.isRecording ? 'Stop recording' : 'Record a hop'"
        :aria-pressed="recorder.isRecording"
        :disabled="!recorder.isRecording && !jamId"
        data-test="record"
        @click="onRecord"
      >
        <LwIcon name="record" />
      </button>
    </div>

    <span v-if="recorder.isArmed" class="lw-badge lw-badge--danger lw-badge--dot" data-test="recording-waiting">
      Waiting for first rifff…
    </span>
    <span v-else-if="recorder.isRecording" class="rec" data-test="recording-elapsed">
      <span class="lw-badge lw-badge--danger lw-badge--dot rec__badge">REC</span>
      <span class="lwlkc-readout rec__clock">{{ formatDuration(elapsed) }}</span>
    </span>

    <div class="transport__right">
      <div class="master" title="Output level" aria-hidden="true">
        <div v-for="(row, c) in meter" :key="c" class="meter" data-test="meter-row">
          <span v-for="seg in row" :key="seg.i" :class="['meter__seg', { 'is-lit': seg.lit }]" :style="seg.style" />
        </div>
      </div>
      <button
        type="button"
        :class="['lw-iconbtn', { 'lw-iconbtn--active': performance.quantiseEntry }]"
        title="Quantise: hold each hop until the next beat"
        aria-label="Quantise hops to the beat"
        :aria-pressed="performance.quantiseEntry"
        data-test="quantise"
        @click="performance.quantiseEntry = !performance.quantiseEntry"
      >
        <LwIcon name="quantise" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePerformanceStore, useRecorderStore } from '../stores';
import LwIcon from './LwIcon.vue';
import { formatDuration } from '../ui/format';

const route = useRoute();
const router = useRouter();
const performance = usePerformanceStore();
const recorder = useRecorderStore();

const SEGMENTS = 18;

// Record needs a jam to record in: the one Hop Recording has open.
const jamId = computed(() =>
  route.name === 'hop-recording' && route.params.jamId ? String(route.params.jamId) : null,
);
const playing = computed(() => performance.state === 'playing');
const canStop = computed(() => playing.value || recorder.isPlaying || recorder.isRecording);

/**
 * Silence everything. A replay has its remaining hops scheduled, and stopping
 * only the engine lets the next one start the audio again.
 */
function stopAudio(): void {
  if (recorder.isPlaying) recorder.stopPlayback();
  performance.stop();
}

// Stop ends whatever is running — playback, a replay or a recording. A
// finished take opens in the hop editor, as the Design Plan has it.
async function onStop(): Promise<void> {
  stopAudio();
  if (!recorder.isRecording) return;
  const take = await recorder.stop();
  if (take) await router.push({ name: 'hop-editing', params: { jamId: take.jamId, id: take.id } });
}

function onPlay(): void {
  if (!playing.value) void performance.resume();
}

// Every take starts at the beginning of a rifff: silence what's playing, so
// the first click after Record is a cold start on a fresh grid.
async function onRecord(): Promise<void> {
  if (recorder.isRecording) {
    await onStop();
    return;
  }
  if (!jamId.value) return;
  stopAudio();
  recorder.start(jamId.value);
}

// The take's timeline begins at the first rifff clicked, not at Record, so
// the clock waits out the armed state.
const elapsed = ref(0);
let clockStartedAt = 0;
let clock: number | null = null;
watch(
  () => recorder.isRecording && !recorder.isArmed,
  (running) => {
    if (running) {
      clockStartedAt = Date.now();
      elapsed.value = 0;
      clock = window.setInterval(() => {
        elapsed.value = (Date.now() - clockStartedAt) / 1000;
      }, 250);
    } else if (clock !== null) {
      window.clearInterval(clock);
      clock = null;
    }
  },
  { immediate: true },
);

// LevelMeter (audio/LevelMeter): green low, amber high, red at the peak.
function segColour(frac: number): string {
  if (frac > 0.9) return 'var(--spectrum-red)';
  if (frac > 0.72) return 'var(--spectrum-amber)';
  return 'var(--spectrum-green)';
}
const levels = ref<[number, number]>([0, 0]);
const meter = computed(() =>
  levels.value.map((level) => {
    const lit = Math.round(Math.min(1, level) * SEGMENTS);
    return Array.from({ length: SEGMENTS }, (_, i) => ({
      i,
      lit: i < lit,
      style: i < lit ? { background: segColour((i + 1) / SEGMENTS) } : undefined,
    }));
  }),
);
let frame = 0;
function readMeter(): void {
  const next = performance.levels();
  if (next[0] !== levels.value[0] || next[1] !== levels.value[1]) levels.value = next;
  frame = requestAnimationFrame(readMeter);
}
onMounted(() => {
  frame = requestAnimationFrame(readMeter);
});
onUnmounted(() => {
  cancelAnimationFrame(frame);
  if (clock !== null) window.clearInterval(clock);
});
</script>

<style scoped>
.transport {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.transport__buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}
.record {
  color: var(--danger);
}
.record.is-recording {
  background: var(--danger);
  border-color: transparent;
  color: var(--on-accent);
  box-shadow: 0 0 18px -3px var(--danger);
}
.rec {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.rec__badge {
  animation: rec-pulse 1.2s var(--ease-out) infinite;
}
@keyframes rec-pulse {
  50% {
    opacity: 0.35;
  }
}
@media (prefers-reduced-motion: reduce) {
  .rec__badge {
    animation: none;
  }
}
.rec__clock {
  font-size: var(--text-xs);
  color: var(--danger);
}
.transport__right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.master {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  width: 150px;
  height: 26px;
  padding: 0 10px;
  background: var(--surface-inset);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}
.meter {
  display: flex;
  gap: 2px;
  height: 6px;
}
.meter__seg {
  flex: 1;
  border-radius: 2px;
  background: var(--surface-3);
  opacity: 0.5;
  transition: background 60ms linear, opacity 60ms linear;
}
.meter__seg.is-lit {
  opacity: 1;
}
</style>
