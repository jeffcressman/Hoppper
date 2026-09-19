<template>
  <div class="editor">
    <div class="strip">
      <div class="strip__title">
        <span class="lwlkc-eyebrow">Hop</span>
        <h1 class="strip__name">{{ editor.take?.title ?? '' }}</h1>
      </div>
      <span class="strip__meta lwlkc-readout" data-test="take-meta">{{ meta }}</span>
    </div>

    <div class="bar">
      <span class="bar__hint" data-test="hint">{{ hint }}</span>
      <div class="bar__actions">
        <template v-if="point !== null && !expanded">
          <button type="button" class="lw-btn lw-btn--danger lw-btn--sm" data-test="delete-point" @click="onDelete">
            <LwIcon name="trash" />
            Delete
          </button>
        </template>
        <button
          v-if="point !== null"
          type="button"
          :class="['lw-btn', 'lw-btn--outline', 'lw-btn--sm', { 'is-on': expanded }]"
          :aria-pressed="expanded"
          :disabled="expanding"
          data-test="expand"
          @click="onExpand"
        >
          <LwIcon name="expand" />
          {{ expanding ? 'Finding…' : 'Expand' }}
        </button>
        <button
          v-if="expanded"
          type="button"
          class="lw-btn lw-btn--primary lw-btn--sm"
          :disabled="pickedSkip === null"
          data-test="add"
          @click="onAdd"
        >
          <LwIcon name="plus" />
          Add
        </button>
        <button
          v-if="pickedSeg !== null"
          type="button"
          class="lw-btn lw-btn--secondary lw-btn--sm"
          data-test="duplicate"
          @click="onDuplicate"
        >
          <LwIcon name="copy" />
          Duplicate
        </button>

        <span class="bar__divider" />
        <div class="snap" role="group" aria-label="Snap hop points to">
          <button
            v-for="s in SNAPS"
            :key="s.value"
            type="button"
            :class="['snap__opt', { 'is-on': snap === s.value }]"
            :aria-pressed="snap === s.value"
            :data-test="`snap-${s.value}`"
            @click="snap = s.value"
          >
            {{ s.label }}
          </button>
        </div>
        <button type="button" class="lw-iconbtn lw-iconbtn--sm" title="Undo" aria-label="Undo" :disabled="!editor.canUndo" data-test="undo" @click="editor.undo()">
          <LwIcon name="undo" />
        </button>
        <button type="button" class="lw-iconbtn lw-iconbtn--sm" title="Redo" aria-label="Redo" :disabled="!editor.canRedo" data-test="redo" @click="editor.redo()">
          <LwIcon name="redo" />
        </button>
        <button
          type="button"
          :class="['lw-btn', 'lw-btn--sm', recorder.isPlaying ? 'lw-btn--secondary' : 'lw-btn--primary']"
          :disabled="!editor.take || recorder.isRecording"
          data-test="play-take"
          @click="onPlay"
        >
          <LwIcon :name="recorder.isPlaying ? 'stop' : 'play'" />
          {{ recorder.isPlaying ? 'Stop' : 'Play' }}
        </button>
      </div>
    </div>
    <p v-if="editor.lastError" class="error" role="alert">{{ editor.lastError }}</p>

    <div ref="timelineEl" class="tl" data-test="timeline" :data-px-per-sec="PX_PER_SEC" @click="clearSelection">
      <div class="tl__inner" :style="{ width: `${width}px`, height: `${height}px` }">
        <span v-for="tick in ticks" :key="tick.label" class="tl__tick lwlkc-readout" :style="{ left: `${tick.x}px` }">
          {{ tick.label }}
        </span>

        <div
          v-for="b in drawn"
          :key="b.key"
          :class="['blk', `is-${b.kind}`, { 'is-picked': b.picked }]"
          :style="{ left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${geometry.laneH}px` }"
          data-test="block"
          @click.stop="onPickBlock(b)"
        >
          <svg
            v-for="row in b.rows"
            :key="row.slot"
            class="blk__row"
            :viewBox="`0 0 ${row.bins} 20`"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path :d="row.d" :style="{ fill: row.colour }" />
          </svg>
        </div>

        <span
          v-for="b in drawn"
          :key="`label-${b.key}`"
          :class="['lbl', 'lwlkc-readout', { 'is-ghost': b.kind === 'ghost' }]"
          :style="{ left: `${b.x + 3}px`, top: `${b.lane === 1 ? LABEL1_Y : geometry.label2Y}px` }"
        >
          {{ b.label }}
        </span>

        <span
          v-for="p in layout.pins"
          :key="`line-${p.key}`"
          :class="['hopline', `is-${p.kind}`]"
          :style="{ left: `${x(p.atSec)}px`, top: '54px', height: `${linesBottom - 54}px` }"
        />
        <button
          v-for="p in layout.pins"
          :key="p.key"
          type="button"
          :class="['pin', `is-${p.kind}`]"
          :style="{ left: `${x(p.atSec)}px` }"
          :title="p.kind === 'candidate' ? 'Where a hop could go' : `Hop point ${p.num}`"
          :disabled="p.hopIndex === undefined"
          data-test="hop-point"
          @pointerdown.stop="(e) => onPinDown(e, p)"
          @click.stop="onPinClick(p)"
        >
          {{ p.num }}
        </button>

        <span v-if="playheadSec !== null" class="take-playhead" :style="{ left: `${x(playheadSec)}px` }" data-test="take-playhead" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { JamCouchID, RiffCouchID, RiffDocument, StemCouchID } from '@hoppper/sdk';
import {
  useHopEditorStore,
  useJamsStore,
  usePerformanceStore,
  useRecorderStore,
  useRiffDocsStore,
  useStemDocsStore,
} from '../stores';
import LwIcon from '../components/LwIcon.vue';
import { moveHop, segmentsOf, type Snap } from '../hop-editor/edits';
import { laneGeometry, timelineLayout, type TimelineBlock, type TimelinePin } from '../hop-editor/layout';
import { phaseRow, rowPath } from '../ui/peaks';
import { riffStemAudio, stemPeaks } from '../ui/riff-audio';
import { stemColour } from '../ui/stem-colour';
import { formatDuration, formatTime } from '../ui/format';
import type { HopSequence } from '../hop-recorder/types';
import { log } from '../logging/log-store';

const route = useRoute();
const editor = useHopEditorStore();
const recorder = useRecorderStore();
const riffDocs = useRiffDocsStore();
const stemDocs = useStemDocsStore();
const performance = usePerformanceStore();
const jamsStore = useJamsStore();

// Timeline geometry, in px. Across: a fixed scale. Down: the lanes fill the
// timeline's height (laneGeometry), measured as the window changes.
const PX_PER_SEC = 16;
const PAD = 20;
const LABEL1_Y = 60;
const x = (sec: number) => PAD + sec * PX_PER_SEC;

const timelineEl = ref<HTMLElement | null>(null);
const timelineHeight = ref(0);
let resizeObserver: ResizeObserver | null = null;
function measure(): void {
  timelineHeight.value = timelineEl.value?.clientHeight ?? 0;
}

const SNAPS: { value: Snap; label: string }[] = [
  { value: 'beat', label: 'Beat' },
  { value: 'bar', label: 'Bar' },
  { value: 'off', label: 'Off' },
];

const jamId = computed(() => String(route.params.jamId) as JamCouchID);
const snap = ref<Snap>('beat');
const point = ref<number | null>(null);
const expanded = ref(false);
const expanding = ref(false);
const skipped = shallowRef<RiffDocument[]>([]);
const skippedNothing = ref(false);
const pickedSeg = ref<number | null>(null);
const pickedSkip = ref<number | null>(null);
// While a hop point is being dragged, the take as it would be if let go here.
const preview = shallowRef<HopSequence | null>(null);

const take = computed(() => preview.value ?? editor.take);

// ── Loading ───────────────────────────────────────────────────────────────

onMounted(async () => {
  // The editor's own mix: the rifffs as committed, whatever the recording
  // page has muted.
  performance.useMix('editor');
  const last = editor.lastOpened;
  const sameTake = last && last.jamId === jamId.value && last.id === String(route.params.id) && editor.take;
  // Coming back to the take already open keeps its undo history.
  if (!sameTake) await editor.open(jamId.value, String(route.params.id));
  void jamsStore.loadProfile(jamId.value);
});

/** Load rifffs' stems so their lanes can be drawn — from disk, as a rule: they were played live. */
async function loadAudio(riffs: RiffDocument[]): Promise<void> {
  const stemIds = riffs.flatMap((r) => r.slots.filter((s) => s.on && s.stemId).map((s) => s.stemId as StemCouchID));
  await stemDocs.ensure(jamId.value, stemIds).catch(() => {});
  for (const r of riffs) {
    try {
      await performance.warm(jamId.value, r);
    } catch (err) {
      log('warn', 'editor', `loading ${r.riffId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

watch(
  () => editor.take?.id,
  () => {
    const seq = editor.take;
    if (!seq) return;
    const riffs = [...new Set(seq.hops.map((h) => h.riffId))]
      .map((id) => riffDocs.get(id))
      .filter((r): r is RiffDocument => !!r);
    void loadAudio(riffs);
  },
  { immediate: true },
);

// Edits can shorten the take; keep the selection pointing at something real.
watch(
  () => editor.take,
  (seq) => {
    const n = seq?.hops.length ?? 0;
    if (point.value !== null && point.value >= n) clearSelection();
    if (pickedSeg.value !== null && pickedSeg.value >= n) pickedSeg.value = null;
  },
);

// ── Layout ────────────────────────────────────────────────────────────────

/** A rifff's loop as it plays, from its decoded stems when they're in. */
function loopSec(riffId: RiffCouchID): number {
  const doc = riffDocs.get(riffId);
  if (!doc) return editor.loopSecOf(riffId);
  const audio = riffStemAudio(doc, stemDocs.get, performance.bufferFor);
  return audio.loopSec > 0 ? audio.loopSec : editor.loopSecOf(riffId);
}

const segments = computed(() => (take.value ? segmentsOf(take.value, editor.gridOf) : []));
const layout = computed(() =>
  timelineLayout(
    segments.value,
    {
      point: point.value,
      skipped: expanded.value ? skipped.value.map((r) => ({ riffId: r.riffId, lengthSec: loopSec(r.riffId) })) : [],
    },
    loopSec,
  ),
);

const geometry = computed(() => laneGeometry(timelineHeight.value, layout.value.split));
const width = computed(() => x(layout.value.endSec) + PAD + 60);
const height = computed(() => geometry.value.height);
const linesBottom = computed(() =>
  layout.value.split ? geometry.value.lane2Y + geometry.value.laneH : geometry.value.lane1Y + geometry.value.laneH,
);

const ticks = computed(() => {
  const out: { label: string; x: number }[] = [];
  const every = 4;
  for (let s = 0; s <= layout.value.endSec; s += every) out.push({ label: formatDuration(s), x: x(s) });
  return out;
});

// Lanes: every block drawn phase-true — what's heard at each moment is the
// rifff at the grid's position then, so a rifff entering mid-loop is drawn
// from mid-loop. Worked out once per block per change, not per frame.
const rowMemo = new Map<string, { slot: number; d: string; bins: number; colour: string }[]>();
function rowsFor(b: TimelineBlock): { slot: number; d: string; bins: number; colour: string }[] {
  const doc = riffDocs.get(b.riffId);
  if (!doc) return [];
  const key = `${b.riffId}|${b.startSec}|${b.endSec}|${performance.decodedTick}`;
  const memo = rowMemo.get(key);
  if (memo) return memo;
  const audio = riffStemAudio(doc, stemDocs.get, performance.bufferFor);
  const bins = Math.max(8, Math.round(((b.endSec - b.startSec) * PX_PER_SEC) / 2));
  const rows = Array.from({ length: 8 }, (_, slot) => {
    const stem = audio.stems[slot];
    const s = doc.slots[slot];
    const stemDoc = s?.on && s.stemId ? stemDocs.get(s.stemId as StemCouchID) : null;
    return {
      slot,
      bins,
      d: stem ? rowPath(phaseRow(stemPeaks(stem.stemId, stem.buffer), stem.loopSec, audio.loopSec, b.startSec, b.endSec, bins)) : '',
      colour: (stemDoc && stemColour(stemDoc.primaryColour)) || 'var(--accent)',
    };
  });
  rowMemo.set(key, rows);
  return rows;
}

const drawn = computed(() => {
  void performance.decodedTick;
  return layout.value.blocks.map((b) => {
    const doc = riffDocs.get(b.riffId);
    return {
      ...b,
      x: x(b.startSec),
      y: b.lane === 1 ? geometry.value.lane1Y : geometry.value.lane2Y,
      w: Math.max(2, (b.endSec - b.startSec) * PX_PER_SEC),
      rows: rowsFor(b),
      label: doc ? `${formatTime(doc.createdAt)} · ${doc.userName}` : b.riffId,
      picked:
        (b.kind === 'seg' && b.segIndex === pickedSeg.value) || (b.kind === 'skip' && b.skipIndex === pickedSkip.value),
    };
  });
});

// ── Words ─────────────────────────────────────────────────────────────────

const meta = computed(() => {
  const seq = editor.take;
  if (!seq) return '';
  const jam = jamsStore.profilesById.get(seq.jamId)?.displayName ?? seq.jamId;
  const n = seq.hops.length;
  return `${jam} · ${n} ${n === 1 ? 'hop' : 'hops'} · ${formatDuration(seq.durationSec)}`;
});

const hint = computed(() => {
  if (skippedNothing.value) return 'This hop skipped nothing: its two rifffs were committed one after the other.';
  if (expanded.value) return 'Skipped rifffs are dashed. Pick one, then Add it to the hop.';
  if (point.value !== null) return `Drag hop point ${point.value} to change when the next rifff comes in. Expand shows what it skipped.`;
  if (pickedSeg.value !== null) return 'Duplicate puts another copy of this rifff right after it.';
  return 'Click a hop point to fine-tune it, or a rifff to duplicate it.';
});

// ── Selection and edits ───────────────────────────────────────────────────

function clearSelection(): void {
  point.value = null;
  expanded.value = false;
  skipped.value = [];
  skippedNothing.value = false;
  pickedSeg.value = null;
  pickedSkip.value = null;
}

function selectPoint(index: number): void {
  if (point.value === index) return;
  clearSelection();
  point.value = index;
}

function onPinClick(p: TimelinePin): void {
  if (p.hopIndex !== undefined) selectPoint(p.hopIndex);
}

function onPickBlock(b: TimelineBlock): void {
  if (b.kind === 'skip' && b.skipIndex !== undefined) {
    pickedSkip.value = b.skipIndex;
  } else if (b.kind === 'seg' && b.segIndex !== undefined) {
    clearSelection();
    pickedSeg.value = b.segIndex;
  }
}

async function onDelete(): Promise<void> {
  if (point.value === null) return;
  const index = point.value;
  clearSelection();
  await editor.deleteHop(index);
}

async function onDuplicate(): Promise<void> {
  if (pickedSeg.value === null) return;
  const index = pickedSeg.value;
  await editor.duplicate(index);
  pickedSeg.value = index + 1;
}

async function expandAt(index: number): Promise<void> {
  expanding.value = true;
  skippedNothing.value = false;
  try {
    const found = await editor.skippedAt(index);
    if (point.value !== index) return;
    skipped.value = found;
    expanded.value = found.length > 0;
    skippedNothing.value = found.length === 0;
    pickedSkip.value = null;
    // Never played, so their stems download now — only because asked.
    void loadAudio(found);
  } catch (err) {
    log('warn', 'editor', `expand: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    expanding.value = false;
  }
}

async function onExpand(): Promise<void> {
  if (point.value === null) return;
  if (expanded.value) {
    expanded.value = false;
    skipped.value = [];
    pickedSkip.value = null;
    return;
  }
  await expandAt(point.value);
}

async function onAdd(): Promise<void> {
  if (point.value === null || pickedSkip.value === null) return;
  const index = point.value;
  const riff = skipped.value[pickedSkip.value];
  if (!riff) return;
  await editor.addRiff(index, riff.riffId);
  // Carry on from the hop point after the added rifff: what's still skipped there.
  point.value = index + 1;
  expanded.value = false;
  await expandAt(index + 1);
}

// Dragging a hop point: a preview while it moves, one edit when it's let go.
let dragCleanup: (() => void) | null = null;
function onPinDown(e: PointerEvent, p: TimelinePin): void {
  if (p.hopIndex === undefined || !editor.take) return;
  const index = p.hopIndex;
  const startX = e.clientX;
  const startSec = p.atSec;
  const base = editor.take;
  if (!(expanded.value && point.value === index)) selectPoint(index);
  if (expanded.value) return;
  const secAt = (clientX: number) => startSec + (clientX - startX) / PX_PER_SEC;
  const move = (ev: PointerEvent | MouseEvent) => {
    if (Math.abs(ev.clientX - startX) < 3) return;
    preview.value = moveHop(base, index, secAt(ev.clientX), snap.value, editor.gridOf);
  };
  const up = (ev: PointerEvent | MouseEvent) => {
    dragCleanup?.();
    preview.value = null;
    if (Math.abs(ev.clientX - startX) >= 3) void editor.moveHop(index, secAt(ev.clientX), snap.value);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  dragCleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    dragCleanup = null;
  };
}

// ── Playback ──────────────────────────────────────────────────────────────

async function onPlay(): Promise<void> {
  if (recorder.isPlaying) {
    recorder.stopPlayback();
    return;
  }
  if (!editor.take) return;
  performance.stop();
  try {
    await recorder.play(editor.take);
  } catch (err) {
    log('warn', 'editor', `play: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const playheadSec = ref<number | null>(null);
let frame = 0;
function follow(): void {
  playheadSec.value = recorder.isPlaying ? recorder.playPosition() : null;
  frame = requestAnimationFrame(follow);
}

// ── Keyboard ──────────────────────────────────────────────────────────────

function onKey(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    void (e.shiftKey ? editor.redo() : editor.undo());
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    void editor.redo();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && point.value !== null && !expanded.value) {
    e.preventDefault();
    void onDelete();
  } else if (e.key === 'Escape') {
    clearSelection();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
  frame = requestAnimationFrame(follow);
  measure();
  if (typeof ResizeObserver !== 'undefined' && timelineEl.value) {
    resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(timelineEl.value);
  }
});
onUnmounted(() => {
  resizeObserver?.disconnect();
  window.removeEventListener('keydown', onKey);
  cancelAnimationFrame(frame);
  dragCleanup?.();
});
</script>

<style scoped>
.editor {
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
.bar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 62px;
  padding: 12px 24px;
}
.bar__hint {
  font-size: var(--text-sm);
  color: var(--text-3);
}
.bar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bar__divider {
  width: 1px;
  height: 22px;
  margin: 0 4px;
  background: var(--line);
}
.lw-btn--outline.is-on {
  background: var(--accent-soft);
}
/* Tabs, pill variant (layout/Tabs) */
.snap {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--r-pill);
  background: var(--surface-inset);
}
.snap__opt {
  padding: 5px 12px;
  border: none;
  border-radius: var(--r-pill);
  background: none;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: var(--text-xs);
  color: var(--text-3);
  cursor: pointer;
}
.snap__opt:hover {
  color: var(--text-1);
}
.snap__opt.is-on {
  background: var(--surface-3);
  color: var(--text-1);
  box-shadow: var(--shadow-sm);
}
.error {
  margin: 0 24px 12px;
  font-size: var(--text-sm);
  color: var(--danger);
}
.tl {
  position: relative;
  flex: 1;
  min-height: 0;
  margin: 0 24px 20px;
  overflow: auto;
  background: var(--surface-inset);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
}
.tl__inner {
  position: relative;
}
.tl__tick {
  position: absolute;
  top: 6px;
  height: 14px;
  padding-left: 4px;
  border-left: 1px solid var(--line);
  font-size: var(--text-2xs);
  line-height: 14px;
  color: var(--text-4);
}
.blk {
  position: absolute;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--surface-1);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}
.blk:hover {
  border-color: var(--text-4);
}
.blk.is-ghost {
  border: 1px dashed var(--accent-line);
  background: var(--accent-soft);
  cursor: default;
}
.blk.is-skip {
  border: 1px dashed var(--accent-line);
  background: var(--accent-soft);
}
.blk.is-skip:hover {
  border-color: var(--accent);
}
.blk.is-picked {
  border: 2px solid var(--accent);
  box-shadow: var(--glow-accent);
}
.blk__row {
  display: block;
  flex: 1;
  width: 100%;
  min-height: 0;
  border-bottom: 1px solid var(--line-faint);
}
.blk__row path {
  fill-opacity: 0.9;
}
.blk.is-ghost .blk__row path {
  fill-opacity: 0.45;
}
.lbl {
  position: absolute;
  height: 18px;
  font-size: var(--text-2xs);
  line-height: 18px;
  color: var(--text-2);
  white-space: nowrap;
  pointer-events: none;
}
.lbl.is-ghost {
  color: var(--text-4);
}
.hopline {
  position: absolute;
  width: 2px;
  margin-left: -1px;
  background: var(--accent);
  pointer-events: none;
}
.hopline.is-selected {
  background: var(--text-1);
  box-shadow: 0 0 10px var(--accent);
}
.hopline.is-candidate {
  width: 0;
  background: none;
  border-left: 2px dashed var(--text-4);
}
.pin {
  position: absolute;
  top: 28px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-left: -12px;
  padding: 0;
  border: 2px solid var(--accent);
  border-radius: 50%;
  background: var(--surface-2);
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  color: var(--accent);
  cursor: grab;
  touch-action: none;
  transition: var(--transition-control);
}
.pin:hover {
  background: var(--surface-3);
}
.pin.is-selected {
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: var(--glow-accent);
  cursor: ew-resize;
}
.pin.is-candidate {
  border-style: dashed;
  border-color: var(--text-4);
  background: var(--surface-inset);
  color: var(--text-3);
  cursor: default;
}
.pin:disabled:not(.is-candidate) {
  cursor: default;
}
.take-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--accent);
  box-shadow: 0 0 10px var(--accent);
  pointer-events: none;
}
</style>
