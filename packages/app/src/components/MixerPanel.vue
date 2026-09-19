<template>
  <div class="mixer" role="group" aria-label="Track mixer">
    <div class="mixer__head">
      <span class="lwlkc-eyebrow">Tracks</span>
      <button
        type="button"
        class="lw-btn lw-btn--ghost lw-btn--sm"
        :disabled="!performance.anySoloed"
        title="Turn every solo off"
        data-test="unsolo"
        @click="performance.clearSolos()"
      >
        Un-solo
      </button>
    </div>
    <div class="mixer__channels">
    <div
      v-for="ch in channels"
      :key="ch.slot"
      :class="['ch', { 'is-empty': !ch.stemId, 'is-muted': ch.muted, 'is-soloed': ch.soloed, 'is-silenced': ch.silenced }]"
      data-test="channel"
    >
      <div class="ch__buttons">
        <button
          type="button"
          class="ch__mute"
          :title="ch.muted ? `Unmute ${ch.name}` : `Mute ${ch.name}`"
          :aria-label="ch.muted ? `Unmute ${ch.name}` : `Mute ${ch.name}`"
          :aria-pressed="ch.muted"
          :disabled="!ch.stemId"
          data-test="mute"
          @click="performance.toggleMute(ch.slot)"
        >
          <span
            class="ch__lamp"
            :style="{
              background: ch.lit ? ch.colour : 'transparent',
              borderColor: ch.lit ? ch.colour : 'var(--line-strong)',
            }"
          />
        </button>
        <button
          type="button"
          class="ch__solo"
          :title="ch.soloed ? `Un-solo ${ch.name}` : `Solo ${ch.name}`"
          :aria-label="ch.soloed ? `Un-solo ${ch.name}` : `Solo ${ch.name}`"
          :aria-pressed="ch.soloed"
          :disabled="!ch.stemId"
          data-test="solo"
          @click="performance.toggleSolo(ch.slot)"
        >
          S
        </button>
      </div>
      <div class="ch__strip">
      <div
        class="fader"
        role="slider"
        :tabindex="ch.stemId ? 0 : -1"
        :aria-label="`${ch.name} volume`"
        aria-orientation="vertical"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="ch.pct"
        @pointerdown="(e) => onFaderDown(e, ch.slot)"
        @keydown="(e) => onFaderKey(e, ch.slot)"
      >
        <div class="fader__track">
          <div class="fader__fill" :style="{ height: `${ch.pct}%`, background: ch.colour }" />
          <div class="fader__thumb" :style="{ bottom: `${ch.pct}%` }" />
        </div>
      </div>
      <!-- LevelMeter, vertical (audio/LevelMeter): what the track is sounding. -->
      <div class="meter" aria-hidden="true" data-test="track-meter">
        <span
          v-for="seg in meterSegments(ch.slot)"
          :key="seg.i"
          :class="['meter__seg', { 'is-lit': seg.lit }]"
          :style="seg.lit ? { background: seg.colour } : undefined"
        />
      </div>
      </div>
      <span class="ch__name" :style="{ color: ch.stemId ? ch.colour : 'var(--text-4)' }" data-test="channel-name">
        {{ ch.name }}
      </span>
      <span class="ch__user">
        <span class="ch__dot" :style="{ background: ch.user ? userColour(ch.user) : 'var(--surface-3)' }" />
        {{ ch.user ?? '—' }}
      </span>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { RiffDocument, StemCouchID } from '@hoppper/sdk';
import { usePerformanceStore, useStemDocsStore } from '../stores';
import { stemColour } from '../ui/stem-colour';
import { userColour } from '../ui/user-colour';

const props = defineProps<{ riff: RiffDocument | null }>();

const performance = usePerformanceStore();
const stemDocs = useStemDocsStore();

const STEP = 0.05;

// Eight channels always: the mixer belongs to the slots, not to one rifff, so
// its levels hold across hops. Names, owners and colours come from the
// playing rifff's stems.
const channels = computed(() =>
  Array.from({ length: 8 }, (_, slot) => {
    const riffSlot = props.riff?.slots[slot];
    const stemId = riffSlot?.on && riffSlot.stemId ? (riffSlot.stemId as StemCouchID) : null;
    const doc = stemId ? stemDocs.get(stemId) : null;
    const muted = performance.slotMuted[slot] ?? false;
    const audible = performance.slotAudible[slot] ?? true;
    return {
      slot,
      stemId,
      muted,
      soloed: performance.slotSoloed[slot] ?? false,
      // Quiet because another track is soloed, not because it's muted.
      silenced: !!stemId && !muted && !audible,
      lit: !!stemId && audible,
      name: stemId ? doc?.presetName || `Track ${slot + 1}` : 'Empty',
      user: stemId ? doc?.creatorUserName || null : null,
      colour: (doc && stemColour(doc.primaryColour)) || 'var(--accent)',
      pct: Math.round((performance.slotLevels[slot] ?? 1) * 100),
    };
  }),
);

// Each track's level, read every frame.
const SEGMENTS = 14;
const meterLevels = ref<number[]>(Array(8).fill(0));
function segColour(frac: number): string {
  if (frac > 0.9) return 'var(--spectrum-red)';
  if (frac > 0.72) return 'var(--spectrum-amber)';
  return 'var(--spectrum-green)';
}
function meterSegments(slot: number): { i: number; lit: boolean; colour: string }[] {
  const lit = Math.round(Math.min(1, meterLevels.value[slot] ?? 0) * SEGMENTS);
  // Bottom segment first, drawn upwards by the column's reverse order.
  return Array.from({ length: SEGMENTS }, (_, i) => ({ i, lit: i < lit, colour: segColour((i + 1) / SEGMENTS) }));
}
let frame = 0;
function readMeters(): void {
  const next = performance.trackMeters();
  if (next.some((v, i) => v !== meterLevels.value[i])) meterLevels.value = next;
  frame = requestAnimationFrame(readMeters);
}
onMounted(() => {
  frame = requestAnimationFrame(readMeters);
});
onUnmounted(() => cancelAnimationFrame(frame));

function onFaderKey(e: KeyboardEvent, slot: number): void {
  const level = performance.slotLevels[slot] ?? 1;
  const delta = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? STEP : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -STEP : 0;
  if (delta === 0) return;
  e.preventDefault();
  performance.setSlotLevel(slot, Math.round((level + delta) * 100) / 100);
}

function onFaderDown(e: PointerEvent, slot: number): void {
  const el = e.currentTarget as HTMLElement;
  const set = (clientY: number) => {
    const r = el.getBoundingClientRect();
    if (r.height <= 0) return;
    performance.setSlotLevel(slot, 1 - (clientY - r.top) / r.height);
  };
  set(e.clientY);
  const move = (ev: PointerEvent) => set(ev.clientY);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
</script>

<style scoped>
.mixer {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px 14px;
  background: var(--surface-1);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
}
.mixer__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 4px;
}
.mixer__channels {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 10px;
}
.ch__buttons {
  display: flex;
  gap: 4px;
}
.ch__strip {
  display: flex;
  align-items: stretch;
  gap: 6px;
}
.meter {
  display: flex;
  flex-direction: column-reverse;
  gap: 2px;
  width: 6px;
  height: 150px;
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
.ch__solo {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: transparent;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: var(--text-xs);
  color: var(--text-3);
  cursor: pointer;
  transition: var(--transition-control);
}
.ch__solo:hover {
  background: var(--surface-2);
  border-color: var(--line-strong);
  color: var(--text-1);
}
.ch__solo:disabled {
  cursor: default;
}
.ch.is-soloed .ch__solo {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}
.ch.is-silenced .fader__fill,
.ch.is-silenced .ch__name {
  opacity: 0.35;
}
.ch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.ch.is-empty {
  opacity: 0.4;
}
.ch.is-empty .fader {
  pointer-events: none;
}
.ch.is-muted .fader__fill {
  opacity: 0.3;
}
.ch__mute {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: transparent;
  cursor: pointer;
  transition: var(--transition-control);
}
.ch__mute:hover {
  background: var(--surface-2);
  border-color: var(--line-strong);
}
.ch__mute:disabled {
  cursor: default;
}
/* The Studio kit's lane checkbox: lit in the stem's colour while it plays. */
.ch__lamp {
  width: 15px;
  height: 15px;
  border: 1.5px solid var(--line-strong);
  border-radius: 4px;
}
/* Slider, vertical fader variant (forms/Slider) */
.fader {
  position: relative;
  display: flex;
  justify-content: center;
  width: 28px;
  height: 150px;
  cursor: ns-resize;
  touch-action: none;
}
.fader__track {
  position: relative;
  width: 6px;
  height: 100%;
  border-radius: var(--r-pill);
  background: var(--surface-inset);
}
.fader__fill {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  border-radius: var(--r-pill);
}
.fader__thumb {
  position: absolute;
  left: 50%;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--text-1);
  box-shadow: var(--shadow-sm);
  transform: translate(-50%, 50%);
  transition: box-shadow var(--dur-fast) var(--ease-out);
}
.fader:hover .fader__thumb {
  box-shadow: var(--shadow-sm), 0 0 0 5px var(--accent-soft);
}
.fader:focus-visible .fader__thumb {
  box-shadow: var(--glow-focus-ring);
}
.ch__name {
  max-width: 100%;
  overflow: hidden;
  font-size: var(--text-xs);
  font-weight: 700;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ch__user {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  height: 20px;
  padding: 0 8px;
  overflow: hidden;
  border-radius: var(--r-pill);
  background: var(--surface-2);
  font-size: var(--text-2xs);
  font-weight: 600;
  color: var(--text-2);
  white-space: nowrap;
}
.ch__dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
</style>
