<template>
  <AppShell>
    <RouterView />
  </AppShell>
  <LogPanel />
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router';
import AppShell from './components/AppShell.vue';
import LogPanel from './views/LogPanel.vue';
</script>
