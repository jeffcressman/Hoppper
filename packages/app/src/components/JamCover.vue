<template>
  <span class="cover" :style="{ '--jam-cover': jamCover(jamId) }">
    <img
      v-if="!jamImageMissing(jamId)"
      :key="jamId"
      :src="jamImageUrl(jamId)"
      alt=""
      loading="lazy"
      decoding="async"
      :class="{ 'is-loaded': loaded }"
      @load="loaded = true"
      @error="markJamImageMissing(jamId)"
    />
  </span>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { jamImageUrl } from '@hoppper/sdk';
import { jamCover } from '../ui/jam-cover';
import { jamImageMissing, markJamImageMissing } from '../ui/jam-image';

// The jam's Endlesss image over its generated cover: the gradient shows while
// the image loads, and stays for a jam that has none.
const props = defineProps<{ jamId: string }>();
const loaded = ref(false);
watch(
  () => props.jamId,
  () => (loaded.value = false),
);
</script>

<style scoped>
.cover {
  position: relative;
  display: block;
  overflow: hidden;
  background: var(--jam-cover);
}
.cover img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.cover img.is-loaded {
  opacity: 1;
}
</style>
