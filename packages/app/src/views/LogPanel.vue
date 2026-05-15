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
        <div class="actions">
          <button type="button" class="btn" data-test="log-copy" @click="onCopy">
            {{ copyLabel }}
          </button>
          <button type="button" class="btn" @click="store.clear()">Clear</button>
        </div>
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
import { computed, ref } from 'vue';
import { useLogStore } from '../logging/log-store';

const store = useLogStore();

const reversed = computed(() => [...store.entries].reverse());
const copyLabel = ref('Copy');

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

function fmtForCopy(): string {
  // Oldest-first so the copy reads top-to-bottom in chronological order,
  // matching how a normal log file looks (the panel renders newest-first
  // for live viewing, but that's the opposite of what you want when
  // pasting into a bug report).
  return store.entries
    .map((e) => {
      const head = `${fmtTime(e.at)} ${e.level.toUpperCase().padEnd(5)} ${e.category}: ${e.message}`;
      return e.data !== undefined ? `${head}\n${fmtData(e.data)}` : head;
    })
    .join('\n');
}

async function onCopy(): Promise<void> {
  const text = fmtForCopy();
  try {
    await navigator.clipboard.writeText(text);
    copyLabel.value = 'Copied';
  } catch {
    // Older webviews / locked-down environments may reject Clipboard API.
    // Fall back to a hidden textarea + execCommand('copy') which works
    // everywhere a contenteditable surface does.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-1000px;top:-1000px;';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      copyLabel.value = 'Copied';
    } catch {
      copyLabel.value = 'Copy failed';
    } finally {
      ta.remove();
    }
  }
  setTimeout(() => {
    copyLabel.value = 'Copy';
  }, 1500);
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
.actions {
  display: flex;
  gap: 0.375rem;
}
.btn {
  background: #333;
  color: #ddd;
  border: 1px solid #555;
  border-radius: 3px;
  padding: 0.125rem 0.5rem;
  cursor: pointer;
  font: inherit;
}
.btn:hover {
  background: #3a3a3a;
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
