<template>
  <div class="log-panel" :class="{ open: store.visible }">
    <button
      class="toggle"
      type="button"
      data-test="log-toggle"
      @click="store.toggle()"
    >
      {{ store.visible ? '▾ Logs' : '▴ Logs' }} ({{ store.entries.length }})
    </button>
    <div v-if="store.visible" class="panel">
      <div class="header">
        <span>Hoppper log — last {{ store.entries.length }} entries</span>
        <button type="button" class="clear" @click="store.clear()">Clear</button>
      </div>
      <ol class="entries">
        <li
          v-for="entry in reversed"
          :key="entry.id"
          class="entry"
          :data-level="entry.level"
        >
          <span class="time">{{ fmtTime(entry.at) }}</span>
          <span class="level">{{ entry.level }}</span>
          <span class="category">{{ entry.category }}</span>
          <span class="message">{{ entry.message }}</span>
          <pre v-if="entry.data !== undefined" class="data">{{ fmtData(entry.data) }}</pre>
        </li>
      </ol>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useLogStore } from '../logging/log-store';

const store = useLogStore();

const reversed = computed(() => [...store.entries].reverse());

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleTimeString('en-GB', { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function fmtData(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}
</script>

<style scoped>
.log-panel {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  pointer-events: none;
}
.toggle {
  pointer-events: auto;
  position: absolute;
  right: 0.5rem;
  bottom: 0.5rem;
  background: #222;
  color: #eee;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
}
.log-panel.open .toggle {
  bottom: calc(40vh + 0.5rem);
}
.panel {
  pointer-events: auto;
  height: 40vh;
  background: #111;
  color: #ddd;
  border-top: 1px solid #444;
  display: flex;
  flex-direction: column;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.25rem 0.5rem;
  background: #1a1a1a;
  border-bottom: 1px solid #333;
}
.clear {
  background: #333;
  color: #ddd;
  border: 1px solid #555;
  border-radius: 3px;
  padding: 0.125rem 0.5rem;
  cursor: pointer;
}
.entries {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}
.entry {
  display: grid;
  grid-template-columns: 7rem 4rem 8rem 1fr;
  gap: 0.5rem;
  padding: 0.125rem 0.5rem;
  border-bottom: 1px solid #1f1f1f;
  white-space: pre-wrap;
  word-break: break-word;
}
.entry[data-level='error'] {
  background: #2b0f12;
  color: #ffb0b0;
}
.entry[data-level='warn'] {
  background: #2a230f;
  color: #ffe28a;
}
.entry[data-level='info'] {
  color: #b8d4ff;
}
.entry[data-level='debug'] {
  color: #888;
}
.time {
  color: #777;
}
.level {
  text-transform: uppercase;
  font-weight: bold;
}
.category {
  color: #999;
}
.data {
  grid-column: 4;
  margin: 0.25rem 0 0;
  padding: 0.25rem 0.5rem;
  background: #0a0a0a;
  border-left: 2px solid #333;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
}
</style>
