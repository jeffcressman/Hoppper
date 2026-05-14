import { defineStore } from 'pinia';
import { ref } from 'vue';
import type {
  EndlesssClient,
  JamCouchID,
  JamListing,
  JamProfile,
} from '@hoppper/sdk';

export type JamsClient = Pick<EndlesssClient, 'listJams' | 'getJam'>;

export function defineJamsStore(client: JamsClient) {
  return defineStore('jams', () => {
    const listing = ref<JamListing | null>(null);
    const profilesById = ref<Map<JamCouchID, JamProfile>>(new Map());
    const inFlight = new Map<JamCouchID, Promise<JamProfile>>();

    async function refresh(): Promise<void> {
      listing.value = await client.listJams();
    }

    async function loadProfile(jamId: JamCouchID): Promise<void> {
      if (profilesById.value.has(jamId)) return;
      const existing = inFlight.get(jamId);
      if (existing) {
        await existing;
        return;
      }
      const p = client.getJam(jamId);
      inFlight.set(jamId, p);
      try {
        const profile = await p;
        profilesById.value.set(jamId, profile);
      } finally {
        inFlight.delete(jamId);
      }
    }

    return { listing, profilesById, refresh, loadProfile };
  });
}
