<template>
  <div class="lw-view">
    <div class="lw-view__head">
      <div>
        <h1 class="lw-view__title">Hops</h1>
        <p class="lw-view__sub">{{ subtitle }}</p>
      </div>
    </div>

    <div v-if="takes.length > 0" class="hops">
      <div class="hops__row hops__head">
        <span />
        <span class="lwlkc-eyebrow">Hop</span>
        <span class="lwlkc-eyebrow" title="When the take was made in Hoppper">Created</span>
        <span class="lwlkc-eyebrow">Hops</span>
        <span class="lwlkc-eyebrow">Length</span>
        <span />
      </div>
      <div
        v-for="take in takes"
        :key="take.seq.id"
        :class="['hops__row', { 'is-playing': take.playing }]"
        data-test="hop-row"
      >
        <button
          type="button"
          :class="['lw-iconbtn', 'lw-iconbtn--solid', 'lw-iconbtn--round', { 'lw-iconbtn--active': take.playing }]"
          :title="take.playing ? 'Pause' : 'Play'"
          :aria-label="take.playing ? `Pause ${take.seq.title}` : `Play ${take.seq.title}`"
          :disabled="recorder.isRecording"
          data-test="play"
          @click="togglePlay(take.seq, take.playing)"
        >
          <LwIcon :name="take.playing ? 'pause' : 'play'" />
        </button>
        <div class="hops__name">
          <div class="hops__title">{{ take.seq.title }}</div>
          <div class="hops__jam">{{ take.jam }}</div>
          <div v-if="take.savedTo" class="hops__note" data-test="export-saved">Saved {{ take.savedTo }}</div>
          <div v-if="take.exportError" class="hops__note hops__note--error" role="alert">
            {{ take.exportError }}
          </div>
        </div>
        <span class="hops__num" data-test="created">{{ take.day }}</span>
        <span class="hops__num lwlkc-readout">{{ take.seq.hops.length }}</span>
        <span class="hops__num lwlkc-readout">{{ take.length }}</span>
        <div class="hops__actions">
          <button
            type="button"
            class="lw-btn lw-btn--secondary lw-btn--sm"
            :aria-label="`Edit ${take.seq.title}`"
            data-test="edit"
            @click="router.push({ name: 'hop-editing', params: { jamId: take.seq.jamId, id: take.seq.id } })"
          >
            <LwIcon name="edit" />
            Edit
          </button>
          <button
            type="button"
            class="lw-btn lw-btn--secondary lw-btn--sm"
            :aria-label="`Export ${take.seq.title} as a WAV file`"
            :disabled="exporter.exportingId !== null && !take.exporting"
            data-test="export"
            @click="exporter.exportTake(take.seq)"
          >
            <LwIcon name="download" />
            {{ take.exporting ? 'Exporting…' : 'Export' }}
          </button>
          <button
            type="button"
            class="lw-iconbtn lw-iconbtn--sm hops__delete"
            title="Delete hop"
            :aria-label="`Delete ${take.seq.title}`"
            data-test="delete"
            @click="confirming = take.seq"
          >
            <LwIcon name="trash" />
          </button>
        </div>
      </div>
    </div>

    <div v-else class="empty">
      <h2>No hops yet</h2>
      <p>Pick a jam and hit record. Every hop you record lands here.</p>
      <button
        type="button"
        class="lw-btn lw-btn--secondary"
        data-test="browse-public"
        @click="router.push({ name: 'public-jams' })"
      >
        Browse Public Jams
      </button>
    </div>

    <div v-if="confirming" class="lw-dialog__scrim" @mousedown.self="confirming = null">
      <div class="lw-dialog" role="dialog" aria-modal="true" style="--dlg-w: 420px">
        <div class="lw-dialog__head">
          <div class="lw-dialog__title">Delete this hop?</div>
        </div>
        <div class="lw-dialog__body">
          <p>“{{ confirming.title }}” will be removed from this computer. This can’t be undone.</p>
        </div>
        <div class="lw-dialog__foot">
          <button type="button" class="lw-btn lw-btn--ghost" data-test="cancel-delete" @click="confirming = null">
            Cancel
          </button>
          <button type="button" class="lw-btn lw-btn--danger" data-test="confirm-delete" @click="onDelete">
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useExportStore, useJamsStore, useRecorderStore, useSessionStore } from '../stores';
import type { HopSequence } from '../hop-recorder/types';
import LwIcon from '../components/LwIcon.vue';
import { formatDay, formatDuration } from '../ui/format';

const recorder = useRecorderStore();
const session = useSessionStore();
const jamsStore = useJamsStore();
const router = useRouter();
const exporter = useExportStore();
const confirming = ref<HopSequence | null>(null);

const takes = computed(() =>
  recorder.allSaved.map((seq) => ({
    seq,
    jam: jamsStore.profilesById.get(seq.jamId)?.displayName ?? seq.jamId,
    day: formatDay(seq.recordedAt),
    length: formatDuration(seq.durationSec),
    playing: recorder.isPlaying && recorder.playingId === seq.id,
    exporting: exporter.exportingId === seq.id,
    // The file's name, not the whole path: enough to find it.
    savedTo: exporter.lastSaved?.id === seq.id ? exporter.lastSaved.path.split(/[\\/]/).pop() : null,
    exportError: exporter.lastError?.id === seq.id ? exporter.lastError.message : null,
  })),
);

const subtitle = computed(() => {
  const n = recorder.allSaved.length;
  return `${n} recorded ${n === 1 ? 'hop' : 'hops'}`;
});

onMounted(() => {
  void recorder.loadAll();
});

// Takes are on disk and play offline; only their jams' names need Endlesss.
watch(
  () => [session.isAuthenticated, recorder.allSaved] as const,
  ([authed, saved]) => {
    if (!authed) return;
    for (const jamId of new Set(saved.map((s) => s.jamId))) void jamsStore.loadProfile(jamId);
  },
  { immediate: true },
);

function togglePlay(seq: HopSequence, playing: boolean): void {
  if (playing) recorder.stopPlayback();
  else void recorder.play(seq);
}

async function onDelete(): Promise<void> {
  const seq = confirming.value;
  if (!seq) return;
  confirming.value = null;
  await recorder.delete(seq.jamId, seq.id);
}
</script>

<style scoped>
.hops {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface-1);
}
.hops__row {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 130px 70px 80px 240px;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border-top: 1px solid var(--line-faint);
  transition: var(--transition-control);
}
.hops__row:hover {
  background: var(--surface-2);
}
.hops__row.is-playing {
  background: var(--accent-soft);
}
.hops__head,
.hops__head:hover {
  padding-top: 10px;
  padding-bottom: 10px;
  border-top: none;
  background: var(--bg-sunken);
}
.hops__name {
  min-width: 0;
}
.hops__title {
  font-weight: 700;
  color: var(--text-1);
  line-height: 1.3;
}
.hops__jam {
  font-size: var(--text-sm);
  color: var(--text-3);
}
.hops__note {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--text-3);
}
.hops__note--error {
  color: var(--danger);
}
.hops__num {
  font-size: var(--text-sm);
  color: var(--text-2);
}
.hops__actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
}
.hops__delete:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: 320px;
  padding: 40px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--r-lg);
  background: var(--surface-inset);
  text-align: center;
}
.empty h2 {
  font-size: var(--text-lg);
}
.empty p {
  max-width: 380px;
  color: var(--text-3);
}
</style>
