<template>
  <div class="perform">
    <div class="strip">
      <div class="strip__title">
        <span class="lwlkc-eyebrow">Jam</span>
        <h1 class="strip__name">{{ displayName }}</h1>
      </div>
      <span v-if="performance.currentRiffId" class="strip__meta lwlkc-readout" data-test="current-riff">
        {{ riffMeta }}
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

      <div class="rec__deck">
        <p v-if="performance.lastError" class="error" data-test="error">
          {{ performance.lastError }}
        </p>
        <MixerPanel :riff="currentRiff" />
        <LoopWaveform :riff="currentRiff" />
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
  useRiffDocsStore,
} from '../stores';
import RiffJournal from '../components/RiffJournal.vue';
import MixerPanel from '../components/MixerPanel.vue';
import LoopWaveform from '../components/LoopWaveform.vue';
import { formatDay, formatTime } from '../ui/format';

const route = useRoute();
const jamsStore = useJamsStore();
const currentJam = useCurrentJamStore();
const performance = usePerformanceStore();
const recorder = useRecorderStore();
const riffDocs = useRiffDocsStore();

// The rifffs this page has fetched serve replay and the editor too.
watch(
  () => currentJam.riffPage,
  (riffs) => riffDocs.remember(riffs),
);

const jamId = computed(() => String(route.params.jamId));
const profile = computed(() => jamsStore.profilesById.get(jamId.value));
const displayName = computed(() => profile.value?.displayName ?? jamId.value);

// The rifff the mixer and waveform show: the one playing, from this jam's
// history. A replay can play one older than the pages loaded so far; then
// they show the slots without names until it's in view.
const currentRiff = computed<RiffDocument | null>(
  () => currentJam.riffPage.find((r) => r.riffId === performance.currentRiffId) ?? null,
);

// "14 Sep 2026 21:40 · lwlkc · 120 BPM" — or the ID, for a rifff a replay is
// playing from beyond the pages loaded.
const riffMeta = computed(() => {
  const r = currentRiff.value;
  if (!r) return performance.currentRiffId ?? '';
  return `${formatDay(r.createdAt)} ${formatTime(r.createdAt)} · ${r.userName} · ${r.bpm} BPM`;
});

// Rifffs clicked and still loading. Their hop — and, while recording, the
// moment it registers — comes when loading finishes, so the splat pulses
// until then.
const loading = ref(new Set<RiffCouchID>());
const lastNotReady = ref<RiffCouchID | null>(null);

onMounted(async () => {
  await Promise.all([jamsStore.loadProfile(jamId.value), currentJam.open(jamId.value)]);
});

// Leaving the jam silences it; the transport stays in the top bar for a
// replay started from Hops.
onUnmounted(() => {
  performance.stop();
  if (recorder.isPlaying) recorder.stopPlayback();
  currentJam.close();
});

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
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.error {
  color: var(--danger);
  font-size: var(--text-sm);
}
</style>
