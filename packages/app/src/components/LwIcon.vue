<script setup lang="ts">
import { h } from 'vue';
import { ICONS, type IconName } from './icons';

const props = defineProps<{ name: IconName; size?: number }>();

const render = () =>
  h(
    'svg',
    {
      width: props.size ?? 24,
      height: props.size ?? 24,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    ICONS[props.name].map(([tag, attrs]) => h(tag, attrs)),
  );
</script>

<template>
  <render />
</template>
