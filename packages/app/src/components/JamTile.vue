<template>
  <button type="button" class="tile" data-test="jam-tile" @click="emit('open')">
    <span :class="['tile__media', { 'is-current': current }]">
      <JamCover :jam-id="jamId" class="tile__cover" />
      <span class="tile__badges">
        <span v-if="personal" class="lw-badge tile__badge--dark">Personal</span>
        <span v-if="current" class="lw-badge lw-badge--solid">Current</span>
      </span>
    </span>
    <span class="tile__body">
      <span class="tile__title" data-test="jam-title">{{ title }}</span>
      <span v-if="meta" class="tile__meta">{{ meta }}</span>
    </span>
  </button>
</template>

<script setup lang="ts">
import JamCover from './JamCover.vue';

defineProps<{
  jamId: string;
  title: string;
  meta?: string;
  personal?: boolean;
  current?: boolean;
}>();
const emit = defineEmits<{ open: [] }>();
</script>

<style scoped>
/* Card, flush variant (layout/Card): cover art dominates, no chrome. */
.tile {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: var(--transition-control);
}
.tile:hover {
  transform: translateY(-2px);
}
.tile__media {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--surface-3);
  transition: var(--transition-control);
}
.tile__cover {
  position: absolute;
  inset: 0;
}
.tile:hover .tile__media {
  box-shadow: var(--shadow-lg);
}
.tile__media.is-current {
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent), 0 0 26px -4px var(--accent);
}
.tile__badges {
  position: absolute;
  left: 10px;
  bottom: 10px;
  display: flex;
  gap: 6px;
}
.tile__badge--dark {
  background: oklch(0.145 0.009 var(--brand-hue) / 0.78);
  color: var(--text-1);
  backdrop-filter: blur(8px);
}
.tile__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 10px 2px 0;
}
.tile__title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: var(--text-md);
  color: var(--text-1);
  letter-spacing: -0.01em;
  line-height: 1.2;
}
.tile__meta {
  font-size: var(--text-sm);
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
