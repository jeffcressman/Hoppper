<template>
  <div class="shell">
    <header class="topbar lwlkc-glass">
      <div class="topbar__brand">
        <LwIcon name="logo" :size="26" />
        <span class="lwlkc-wordmark">Hoppper</span>
      </div>
      <TransportBar />
      <div class="topbar__right">
        <button
          type="button"
          :class="['lw-iconbtn', { 'lw-iconbtn--active': route.name === 'settings' }]"
          title="Settings"
          aria-label="Settings"
          data-test="settings"
          @click="router.push({ name: 'settings' })"
        >
          <LwIcon name="gear" />
        </button>
      </div>
    </header>

    <div class="shell__body">
      <nav class="rail" aria-label="Main">
        <button
          v-for="item in top"
          :key="item.label"
          type="button"
          :class="['rail__item', { 'is-active': item.active }]"
          :disabled="item.disabled"
          :aria-current="item.active ? 'page' : undefined"
          :title="item.title"
          data-test="rail-item"
          @click="item.go"
        >
          <LwIcon :name="item.icon" />
          <span class="rail__label">{{ item.label }}</span>
        </button>
        <span class="rail__spacer" />
        <button
          type="button"
          class="rail__item"
          disabled
          title="Account — not designed yet"
          data-test="rail-item"
        >
          <LwIcon name="user" />
          <span class="rail__label">Account</span>
        </button>
      </nav>

      <main class="shell__main">
        <slot />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCurrentJamStore, useHopEditorStore } from '../stores';
import LwIcon from './LwIcon.vue';
import TransportBar from './TransportBar.vue';
import type { IconName } from './icons';

const route = useRoute();
const router = useRouter();
const currentJam = useCurrentJamStore();
const editor = useHopEditorStore();

interface RailItem {
  label: string;
  icon: IconName;
  active: boolean;
  disabled?: boolean;
  title?: string;
  go: () => void;
}

const top = computed<RailItem[]>(() => [
  {
    label: 'Current Jam',
    icon: 'note',
    active: route.name === 'hop-recording',
    disabled: currentJam.lastJamId === null,
    title: currentJam.lastJamId === null ? 'Open a jam first' : undefined,
    go: () => {
      if (currentJam.lastJamId !== null) {
        void router.push({ name: 'hop-recording', params: { jamId: currentJam.lastJamId } });
      }
    },
  },
  { label: 'My Jams', icon: 'headphones', active: route.name === 'my-jams', go: () => void router.push({ name: 'my-jams' }) },
  { label: 'Public Jams', icon: 'users', active: route.name === 'public-jams', go: () => void router.push({ name: 'public-jams' }) },
  { label: 'Hops', icon: 'hops', active: route.name === 'hops', go: () => void router.push({ name: 'hops' }) },
  {
    label: 'Editor',
    icon: 'editor',
    active: route.name === 'hop-editing',
    disabled: editor.lastOpened === null,
    title: editor.lastOpened === null ? 'Open a hop to edit first' : undefined,
    go: () => {
      const last = editor.lastOpened;
      if (last) void router.push({ name: 'hop-editing', params: { jamId: last.jamId, id: last.id } });
    },
  },
]);
</script>

<style scoped>
.shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  overflow: hidden;
}
.topbar {
  position: relative;
  z-index: 20;
  flex: none;
  display: flex;
  align-items: center;
  gap: 20px;
  height: 60px;
  padding: 0 16px;
  border-width: 0 0 1px;
  border-bottom-color: var(--line);
}
.topbar__brand {
  flex: none;
  width: 200px;
  display: flex;
  align-items: center;
  gap: 11px;
  color: var(--accent);
}
.topbar__brand .lwlkc-wordmark {
  font-size: 15px;
}
.topbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.shell__body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.shell__main {
  flex: 1;
  min-width: 0;
  overflow: auto;
}

/* NavRail (layout/NavRail) */
.rail {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: var(--rail-w);
  padding: 16px 8px;
  background: var(--bg-sunken);
  border-right: 1px solid var(--line);
}
.rail__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 11px 4px;
  border-radius: var(--r-md);
  border: 1.5px solid transparent;
  color: var(--text-3);
  cursor: pointer;
  transition: var(--transition-control);
  background: none;
  font-family: var(--font-sans);
}
.rail__item:hover {
  color: var(--text-1);
  background: var(--surface-1);
}
.rail__item.is-active {
  color: var(--text-1);
  border-color: var(--line-strong);
  background: var(--surface-1);
}
.rail__item:disabled {
  opacity: 0.4;
  pointer-events: none;
}
.rail__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1.2;
  text-align: center;
}
.rail__spacer {
  flex: 1;
}
</style>
