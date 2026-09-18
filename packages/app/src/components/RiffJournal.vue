<template>
  <div class="journal">
    <section v-for="day in days" :key="day.label" data-test="journal-group">
      <h3 class="journal__day" data-test="journal-day">{{ day.label }}</h3>
      <div class="splats">
        <div
          v-for="entry in day.entries"
          :key="entry.riff.riffId"
          :class="['splat-cell', { current: entry.riff.riffId === currentRiffId, loading: loadingIds.has(entry.riff.riffId) }]"
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
import { useStemDocsStore } from '../stores';
import { riffSplat } from '../ui/splat';
import { userColour } from '../ui/user-colour';
import { formatDay, formatTime } from '../ui/format';
import { log } from '../logging/log-store';

const props = defineProps<{
  jamId: JamCouchID;
  /** Newest first, as the jam's pages arrive. */
  riffs: RiffDocument[];
  currentRiffId: RiffCouchID | null;
  loadingIds: Set<RiffCouchID>;
  notReadyId: RiffCouchID | null;
}>();
const emit = defineEmits<{ hop: [riff: RiffDocument] }>();

const stemDocs = useStemDocsStore();

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

const days = computed(() => {
  const groups: { label: string; entries: { riff: RiffDocument; time: string; splat: ReturnType<typeof riffSplat> }[] }[] = [];
  for (const riff of props.riffs) {
    const label = formatDay(riff.createdAt);
    let group = groups[groups.length - 1];
    if (!group || group.label !== label) {
      group = { label, entries: [] };
      groups.push(group);
    }
    group.entries.push({ riff, time: formatTime(riff.createdAt), splat: riffSplat(riff, stemDocs.get) });
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
