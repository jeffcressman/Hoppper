<template>
  <div class="journal">
    <section v-for="day in days" :key="day.label" data-test="journal-group">
      <h3 class="journal__day" data-test="journal-day">{{ day.label }}</h3>
      <div class="splats">
        <div
          v-for="entry in day.entries"
          :key="entry.riff.riffId"
          :class="[
            'splat-cell',
            {
              current: entry.riff.riffId === currentRiffId,
              last: entry.riff.riffId === lastRiffId && entry.riff.riffId !== currentRiffId,
              loading: loadingIds.has(entry.riff.riffId),
            },
          ]"
          data-test="riff-row"
        >
          <button
            type="button"
            class="splat"
            :title="`${entry.time} · ${entry.riff.userName}`"
            :aria-label="`Hop to the rifff ${entry.riff.userName} committed at ${entry.time}`"
            data-test="hop"
            @click="emit('hop', entry.riff)"
          >
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <path v-for="(layer, i) in entry.splat.layers" :key="i" :d="layer.d" :style="{ fill: layer.colour }" />
            </svg>
            <span class="splat__user" :style="{ background: userColour(entry.riff.userName) }" data-test="splat-user">
              {{ entry.riff.userName.charAt(0).toUpperCase() }}
            </span>
          </button>
          <span v-if="notReadyId === entry.riff.riffId" class="lw-badge lw-badge--accent busy" data-test="busy-badge">
            buffering…
          </span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import type { JamCouchID, RiffCouchID, RiffDocument, StemCouchID } from '@hoppper/sdk';
import { usePerformanceStore, useStemDocsStore } from '../stores';
import { riffSplat } from '../ui/splat';
import { riffStemAudio, waveRing } from '../ui/riff-audio';
import { userColour } from '../ui/user-colour';
import { formatDay, formatTime } from '../ui/format';
import { log } from '../logging/log-store';

const props = defineProps<{
  jamId: JamCouchID;
  /** Newest first, as the jam's pages arrive. */
  riffs: RiffDocument[];
  currentRiffId: RiffCouchID | null;
  /** The last rifff played, ringed dashed while the transport is stopped. */
  lastRiffId?: RiffCouchID | null;
  loadingIds: Set<RiffCouchID>;
  notReadyId: RiffCouchID | null;
}>();
const emit = defineEmits<{ hop: [riff: RiffDocument] }>();

const stemDocs = useStemDocsStore();
const performance = usePerformanceStore();

// Slices of the loop around a splat drawn from audio: a peak and a trough
// each, so 256 points — over one per pixel of a splat's outline, enough for
// a waveform to read as one without making every hop redraw a heavy page.
const SHAPE_SLICES = 128;

/**
 * Each decoded stem's waveform wrapped once around the rifff's loop, for its
 * splat layer. A stem reused across rifffs is decoded once and shapes all of
 * them.
 */
function shapesFor(riff: RiffDocument): (id: StemCouchID) => Float32Array | undefined {
  const audio = riffStemAudio(riff, stemDocs.get, performance.bufferFor);
  const byStem = new Map<StemCouchID, Float32Array>();
  for (const stem of audio.stems) {
    if (!stem || byStem.has(stem.stemId)) continue;
    byStem.set(stem.stemId, waveRing(stem, audio.loopSec, SHAPE_SLICES));
  }
  return (id) => byStem.get(id);
}

// One request per page of rifffs for the colours; the store skips every stem
// it already holds, so a new page asks only for its new stems.
watch(
  () => props.riffs,
  (riffs) => {
    const ids = riffs.flatMap((r) =>
      r.slots.filter((s) => s.on && s.stemId).map((s) => s.stemId as StemCouchID),
    );
    stemDocs.ensure(props.jamId, ids).catch((err) => {
      log('warn', 'journal', `stem documents for splats: ${err instanceof Error ? err.message : String(err)}`);
    });
  },
  { immediate: true },
);

// A splat only changes when one of its stems' documents or audio arrives, so
// each is worked out once per such change, not on every hop.
const splatMemo = new Map<RiffCouchID, { key: string; splat: ReturnType<typeof riffSplat> }>();

function splatOf(riff: RiffDocument): ReturnType<typeof riffSplat> {
  const key = riff.slots
    .filter((s) => s.on && s.stemId)
    .map((s) => {
      const id = s.stemId as StemCouchID;
      const doc = stemDocs.get(id);
      const decoded = performance.bufferFor(id) !== undefined;
      return `${id}:${doc === undefined ? '?' : doc === null ? 'x' : 'd'}${decoded ? '+' : ''}`;
    })
    .join('|');
  const memo = splatMemo.get(riff.riffId);
  if (memo && memo.key === key) return memo.splat;
  const splat = riffSplat(riff, stemDocs.get, shapesFor(riff));
  splatMemo.set(riff.riffId, { key, splat });
  return splat;
}

const days = computed(() => {
  // Redrawn after each new rifff starts: its stems have just been decoded.
  void performance.decodedTick;
  const groups: { label: string; entries: { riff: RiffDocument; time: string; splat: ReturnType<typeof riffSplat> }[] }[] = [];
  for (const riff of props.riffs) {
    const label = formatDay(riff.createdAt);
    let group = groups[groups.length - 1];
    if (!group || group.label !== label) {
      group = { label, entries: [] };
      groups.push(group);
    }
    group.entries.push({ riff, time: formatTime(riff.createdAt), splat: splatOf(riff) });
  }
  return groups;
});
</script>

<style scoped>
.journal__day {
  margin: 4px 0 10px;
  font-size: var(--text-base);
  color: var(--text-1);
}
.splats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
  gap: 12px 6px;
  margin-bottom: 20px;
}
.splat-cell {
  position: relative;
}
.splat {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1;
  padding: 3px;
  border: none;
  border-radius: 50%;
  background: none;
  cursor: pointer;
  transition: var(--transition-control);
}
.splat svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.splat:hover {
  transform: scale(1.07);
}
.current .splat {
  box-shadow: 0 0 0 2px var(--accent), 0 0 20px -2px var(--accent);
}
/* Stopped: where playback left off, dashed so it doesn't read as playing. */
.last .splat {
  outline: 2px dashed var(--accent);
  outline-offset: 1px;
}
.loading .splat {
  animation: splat-loading 0.7s ease-in-out infinite alternate;
}
@keyframes splat-loading {
  from {
    box-shadow: 0 0 0 2px var(--accent-line);
  }
  to {
    box-shadow: 0 0 0 2px var(--accent), 0 0 18px -2px var(--accent);
  }
}
@media (prefers-reduced-motion: reduce) {
  .loading .splat {
    animation: none;
    box-shadow: 0 0 0 2px var(--accent);
  }
}
.splat__user {
  position: absolute;
  right: -3px;
  bottom: -3px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 2px solid var(--bg-sunken);
  border-radius: 50%;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 10px;
  line-height: 1;
  color: var(--on-accent);
}
.busy {
  position: absolute;
  left: 50%;
  top: 100%;
  transform: translate(-50%, 4px);
  z-index: 1;
}
</style>
