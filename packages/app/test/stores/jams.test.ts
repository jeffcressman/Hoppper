import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { defineJamsStore, type JamsClient } from '../../src/stores/jams';
import type { JamListing, JamProfile } from '@hoppper/sdk';

const listing: JamListing = {
  personal: { jamId: 'alice', category: 'personal' },
  subscribed: [{ jamId: 'band1', category: 'subscribed', joinedAt: '2024-01-01' }],
  joinable: [{ jamId: 'band2', category: 'joinable' }],
};

const band1Profile: JamProfile = { jamId: 'band1', displayName: 'Band One', bio: '' };
const band2Profile: JamProfile = { jamId: 'band2', displayName: 'Band Two' };

function makeStub(overrides: Partial<JamsClient> = {}): JamsClient {
  return {
    listJams: vi.fn(async () => listing),
    getJam: vi.fn(async (id: string) => (id === 'band1' ? band1Profile : band2Profile)),
    ...overrides,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('useJamsStore', () => {
  it('starts empty', () => {
    const useStore = defineJamsStore(makeStub());
    const store = useStore();
    expect(store.listing).toBeNull();
    expect(store.profilesById.size).toBe(0);
  });

  it('refresh populates listing', async () => {
    const client = makeStub();
    const useStore = defineJamsStore(client);
    const store = useStore();

    await store.refresh();
    expect(client.listJams).toHaveBeenCalledTimes(1);
    expect(store.listing).toEqual(listing);
  });

  it('loadProfile caches the result in profilesById', async () => {
    const client = makeStub();
    const useStore = defineJamsStore(client);
    const store = useStore();

    await store.loadProfile('band1');
    expect(client.getJam).toHaveBeenCalledWith('band1');
    expect(store.profilesById.get('band1')).toEqual(band1Profile);
  });

  it('loadProfile for an already-cached id is a no-op', async () => {
    const client = makeStub();
    const useStore = defineJamsStore(client);
    const store = useStore();

    await store.loadProfile('band1');
    await store.loadProfile('band1');
    expect(client.getJam).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent loadProfile calls into one network hit', async () => {
    let resolveJam: (p: JamProfile) => void = () => {};
    const client = makeStub({
      getJam: vi.fn(
        () => new Promise<JamProfile>((r) => (resolveJam = r)),
      ),
    });
    const useStore = defineJamsStore(client);
    const store = useStore();

    const p1 = store.loadProfile('band1');
    const p2 = store.loadProfile('band1');
    resolveJam(band1Profile);
    await Promise.all([p1, p2]);

    expect(client.getJam).toHaveBeenCalledTimes(1);
  });
});
