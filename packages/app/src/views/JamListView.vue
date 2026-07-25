<template>
  <main class="jams">
    <header>
      <h1>Jams</h1>
    </header>
    <p v-if="!listing" class="muted">Loading jams…</p>
    <template v-else>
      <section>
        <h2>Personal</h2>
        <ul>
          <li>
            <RouterLink :to="`/jams/${listing.personal.jamId}`">
              {{ jamLabel(listing.personal.jamId) }}
            </RouterLink>
          </li>
        </ul>
      </section>
      <section>
        <h2>Subscribed ({{ listing.subscribed.length }})</h2>
        <ul>
          <li v-for="jam in subscribedNewestFirst" :key="jam.jamId">
            <RouterLink :to="`/jams/${jam.jamId}`">{{ jamLabel(jam.jamId) }}</RouterLink>
          </li>
        </ul>
      </section>
      <section>
        <h2>Joinable ({{ listing.joinable.length }})</h2>
        <ul>
          <li v-for="jam in joinableNewestFirst" :key="jam.jamId">
            <RouterLink :to="`/jams/${jam.jamId}`">{{ jamLabel(jam.jamId) }}</RouterLink>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useJamsStore } from '../stores';

const jamsStore = useJamsStore();
const listing = computed(() => jamsStore.listing);

// Store order is oldest-first (matches the CouchDB view); the list displays newest-first.
const subscribedNewestFirst = computed(() => [...(listing.value?.subscribed ?? [])].reverse());
const joinableNewestFirst = computed(() => [...(listing.value?.joinable ?? [])].reverse());

onMounted(async () => {
  await jamsStore.refresh();
  const listed = jamsStore.listing;
  if (!listed) return;
  const jamIds = [
    listed.personal.jamId,
    ...listed.subscribed.map((jam) => jam.jamId),
    ...listed.joinable.map((jam) => jam.jamId),
  ];
  await Promise.all(jamIds.map((jamId) => jamsStore.loadProfile(jamId)));
});

function jamLabel(jamId: string): string {
  const profile = jamsStore.profilesById.get(jamId);
  return profile?.displayName ?? jamId;
}
</script>

<style scoped>
.jams {
  max-width: 48rem;
  margin: 2rem auto;
  font-family: system-ui, sans-serif;
}
.muted {
  color: #888;
}
section {
  margin-bottom: 2rem;
}
ul {
  list-style: none;
  padding: 0;
}
li {
  padding: 0.4rem 0;
}
</style>
