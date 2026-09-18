<template>
  <div class="gate">
    <div class="gate__stripes" />
    <div class="gate__veil" />
    <div class="gate__inner">
      <h2>{{ title }}</h2>
      <p>{{ body }}</p>
      <button type="button" class="lw-btn lw-btn--primary lw-btn--lg" data-test="login" @click="emit('login')">
        Log in
        <LwIcon name="chevR" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import LwIcon from './LwIcon.vue';

defineProps<{ title: string; body: string }>();
const emit = defineEmits<{ login: [] }>();
</script>

<style scoped>
/* The design system's splash: the rainbow diagonal stripe under a dark veil. */
.gate {
  position: relative;
  display: grid;
  place-items: center;
  height: 440px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--r-xl);
}
.gate__stripes {
  position: absolute;
  inset: -30%;
  background: repeating-linear-gradient(
    48deg,
    var(--spectrum-red) 0 34px,
    var(--spectrum-amber) 34px 68px,
    var(--spectrum-yellow) 68px 102px,
    var(--spectrum-green) 102px 136px,
    var(--spectrum-teal) 136px 170px,
    var(--spectrum-blue) 170px 204px,
    var(--spectrum-violet) 204px 238px,
    var(--spectrum-pink) 238px 272px
  );
  opacity: 0.22;
}
.gate__veil {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 50% 46%, transparent, var(--bg) 70%);
}
.gate__inner {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  text-align: center;
}
.gate__inner h2 {
  font-size: var(--text-xl);
}
.gate__inner p {
  max-width: 360px;
  color: var(--text-3);
}
</style>
