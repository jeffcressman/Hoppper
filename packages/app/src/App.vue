<template>
  <RouterView />
  <LogPanel />
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router';
import LogPanel from './views/LogPanel.vue';
</script>
