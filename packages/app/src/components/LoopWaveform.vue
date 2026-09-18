<template>
  <div class="wave" aria-label="Waveform of the playing rifff">
    <div class="wave__ruler">
      <span
        v-for="tick in ticks"
        :key="tick.label"
        class="wave__tick lwlkc-readout"
        :style="{ left: `${tick.left}%` }"
        data-test="bar-tick"
      >
        {{ tick.label }}
      </span>
    </div>
    <div class="wave__rows">
      <svg
        v-for="row in rows"
        :key="row.slot"
        :class="['wave__row', { 'is-muted': row.muted }]"
        :viewBox="`0 0 ${BINS} 20`"
        preserveAspectRatio="none"
        aria-hidden="true"
        data-test="wave-row"
      >
        <path :d="row.d" :style="{ fill: row.colour }" />
      </svg>
      <span v-for="tick in ticks.slice(1)" :key="`bar-${tick.label}`" class="wave__bar" :style="{ left: `${tick.left}%` }" />
      <span v-if="headPct !== null" class="playhead" :style="{ left: `${headPct}%` }" data-test="playhead" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { RiffDocument, StemCouchID } from '@hoppper/sdk';
import { usePerformanceStore, useStemDocsStore } from '../stores';
import { computeRiffTiming } from '../audio/riff-timing';
import { bufferPeaks, loopRow, rowPath, type PeakSource } from '../ui/peaks';
import { stemColour } from '../ui/stem-colour';

const props = defineProps<{ riff: RiffDocument | null }>();

const performance = usePerformanceStore();
const stemDocs = useStemDocsStore();

const BINS = 240;
const PEAK_BINS = 512;

// A stem's audio never changes, so its peaks are worked out once, ever.
const peaksCache = new Map<StemCouchID, Float32Array>();

function isPeakSource(b: unknown): b is PeakSource & { duration: number } {
  return !!b && typeof (b as PeakSource).getChannelData === 'function';
}

// Each stem in rifff time: a stem from a rifff at another tempo plays at
// riff.bps / stem.bps (LORE's stemTimeScale), which changes its length.
const stems = computed(() => {
  const riff = props.riff;
  if (!riff) return [];
  return Array.from({ length: 8 }, (_, slot) => {
    const s = riff.slots[slot];
    const stemId = s?.on && s.stemId ? (s.stemId as StemCouchID) : null;
    const doc = stemId ? stemDocs.get(stemId) : null;
    const buffer = stemId ? performance.bufferFor(stemId) : undefined;
    const rate = doc && doc.bps > 0 && riff.bps > 0 ? riff.bps / doc.bps : 1;
    return {
      slot,
      stemId,
      doc,
      buffer: isPeakSource(buffer) ? buffer : null,
      loopSec: isPeakSource(buffer) ? buffer.duration / rate : 0,
    };
  });
});

const timing = computed(() => (props.riff ? computeRiffTiming(props.riff) : null));

// The loop as it plays: the computed length, pushed out to fit its longest
// stem — as RiffVoice.effectiveLoopSec.
const loopSec = computed(() =>
  Math.max(timing.value?.loopDurationSec ?? 0, ...stems.value.map((s) => s.loopSec)),
);

const rows = computed(() =>
  Array.from({ length: 8 }, (_, slot) => {
    const s = stems.value[slot];
    let d = '';
    if (s?.stemId && s.buffer) {
      let peaks = peaksCache.get(s.stemId);
      if (!peaks) {
        peaks = bufferPeaks(s.buffer, PEAK_BINS);
        peaksCache.set(s.stemId, peaks);
      }
      d = rowPath(loopRow(peaks, s.loopSec, loopSec.value, BINS));
    }
    return {
      slot,
      d,
      muted: performance.slotMuted[slot] ?? false,
      colour: (s?.doc && stemColour(s.doc.primaryColour)) || 'var(--accent)',
    };
  }),
);

const ticks = computed(() => {
  const secPerBar = timing.value?.secPerBar ?? 0;
  if (!(secPerBar > 0) || !(loopSec.value > 0)) return [];
  const bars = Math.max(1, Math.round(loopSec.value / secPerBar));
  return Array.from({ length: bars }, (_, b) => ({ label: b + 1, left: (b / bars) * 100 }));
});

// The playhead follows the engine every frame, so it sits where the audio is.
const headPct = ref<number | null>(null);
let frame = 0;
function follow(): void {
  const head = performance.playhead();
  headPct.value =
    head && props.riff && head.riffId === props.riff.riffId && head.loopSec > 0
      ? (head.positionSec / head.loopSec) * 100
      : null;
  frame = requestAnimationFrame(follow);
}
onMounted(() => {
  frame = requestAnimationFrame(follow);
});
onUnmounted(() => cancelAnimationFrame(frame));
</script>

<style scoped>
.wave {
  padding: 10px 14px 14px;
  background: var(--surface-inset);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
}
.wave__ruler {
  position: relative;
  height: 18px;
  margin-bottom: 4px;
}
.wave__tick {
  position: absolute;
  top: 0;
  height: 14px;
  padding-left: 4px;
  border-left: 1px solid var(--line);
  font-size: var(--text-2xs);
  line-height: 14px;
  color: var(--text-4);
}
.wave__rows {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wave__row {
  display: block;
  width: 100%;
  height: 24px;
}
.wave__row path {
  fill-opacity: 0.9;
}
.wave__row.is-muted path {
  fill-opacity: 0.15;
}
.wave__bar {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--line);
  pointer-events: none;
}
.playhead {
  position: absolute;
  top: -6px;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--accent);
  box-shadow: 0 0 10px var(--accent);
  pointer-events: none;
}
.playhead::before {
  content: '';
  position: absolute;
  top: 0;
  left: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}
</style>
