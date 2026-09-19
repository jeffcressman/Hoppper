import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { jamImageUrl } from '@hoppper/sdk';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import type { HopSequence } from '../../src/hop-recorder/types';

enableAutoUnmount(afterEach);

const recorderStub = vi.hoisted(() => ({
  allSaved: [] as HopSequence[],
  isPlaying: false,
  isRecording: false,
  playingId: null as string | null,
  loadAll: vi.fn(async () => {}),
  renameOldTakes: vi.fn(async () => {}),
  play: vi.fn(async () => {}),
  stopPlayback: vi.fn(),
  delete: vi.fn(async () => {}),
}));
const sessionStub = vi.hoisted(() => ({ isAuthenticated: true }));
const exportStub = vi.hoisted(() => ({
  exportingId: null as string | null,
  lastSaved: null as null | { id: string; path: string },
  lastError: null as null | { id: string; message: string },
  exportTake: vi.fn(async () => {}),
}));
const jamsStub = vi.hoisted(() => ({
  profilesById: new Map<string, { displayName: string }>(),
  loadProfile: vi.fn(async (_jamId: string) => {}),
}));

vi.mock('../../src/stores', async () => {
  const { reactive } = await import('vue');
  const recorder = reactive(recorderStub);
  const exportState = reactive(exportStub);
  const session = reactive(sessionStub);
  return {
    useRecorderStore: () => recorder,
    useSessionStore: () => session,
    useJamsStore: () => jamsStub,
    useExportStore: () => exportState,
    __recorder: recorder,
    __session: session,
  };
});

const routerPush = vi.hoisted(() => vi.fn());
vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRouter: () => ({ push: routerPush }),
}));

import * as stores from '../../src/stores';
import HopsView from '../../src/views/HopsView.vue';

const recorder = (stores as unknown as { __recorder: typeof recorderStub }).__recorder;
const session = (stores as unknown as { __session: typeof sessionStub }).__session;

function take(overrides: Partial<HopSequence> = {}): HopSequence {
  return {
    schemaVersion: 1,
    id: 'take-1',
    title: 'Sunday drift',
    jamId: 'band1',
    recordedAt: '2026-09-14T12:00:00.000Z',
    durationSec: 252,
    hops: [
      { tSec: 0, riffId: 'r1', jamId: 'band1', transitionMs: 0 },
      { tSec: 8, riffId: 'r2', jamId: 'band1', transitionMs: 250 },
      { tSec: 16, riffId: 'r3', jamId: 'band1', transitionMs: 250 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  recorder.allSaved = [take(), take({ id: 'take-2', title: 'Warm-up', jamId: 'me', durationSec: 80 })];
  recorder.isPlaying = false;
  recorder.isRecording = false;
  recorder.playingId = null;
  recorderStub.loadAll.mockReset().mockResolvedValue(undefined);
  recorderStub.renameOldTakes.mockReset().mockResolvedValue(undefined);
  recorderStub.play.mockReset().mockResolvedValue(undefined);
  recorderStub.stopPlayback.mockReset();
  recorderStub.delete.mockReset().mockResolvedValue(undefined);
  session.isAuthenticated = true;
  jamsStub.profilesById = new Map([['band1', { displayName: 'Hoppper' }]]);
  jamsStub.loadProfile.mockReset().mockResolvedValue(undefined);
  routerPush.mockReset();
  exportStub.exportingId = null;
  exportStub.lastSaved = null;
  exportStub.lastError = null;
  exportStub.exportTake.mockReset().mockResolvedValue(undefined);
});

const rows = (w: ReturnType<typeof mount>) => w.findAll('[data-test="hop-row"]');

describe('HopsView', () => {
  it('reads every saved take when it opens', () => {
    mount(HopsView);
    expect(recorderStub.loadAll).toHaveBeenCalledTimes(1);
  });

  it('lists each take with its jam, day, number of hops and length', () => {
    const wrapper = mount(HopsView);
    expect(wrapper.find('h1').text()).toBe('Hops');
    expect(wrapper.text()).toContain('2 recorded hops');
    const first = rows(wrapper)[0].text();
    expect(first).toContain('Sunday drift');
    expect(first).toContain('Hoppper');
    expect(first).toContain('14 Sep 2026');
    expect(first).toContain('3');
    expect(first).toContain('4:12');
    // No profile yet: the jam ID stands in for the name.
    expect(rows(wrapper)[1].text()).toContain('me');
  });

  it('shows each take’s jam image to the left of its play button', () => {
    const rows = mount(HopsView).findAll('[data-test="hop-row"]');
    expect(rows.map((r) => r.find('[data-test="jam-cover"] img').attributes('src'))).toEqual([
      jamImageUrl('band1'),
      jamImageUrl('me'),
    ]);
    const cells = rows[0].element.children;
    expect(cells[0].getAttribute('data-test')).toBe('jam-cover');
    expect(cells[1].getAttribute('data-test')).toBe('play');
  });

  it('looks up the name of each jam that has a take, once each', async () => {
    recorder.allSaved = [take(), take({ id: 'x' }), take({ id: 'y', jamId: 'me' })];
    mount(HopsView);
    await flushPromises();
    expect(jamsStub.loadProfile.mock.calls.map((c) => c[0]).sort()).toEqual(['band1', 'me']);
  });

  it('asks Endlesss for no names when logged out', async () => {
    session.isAuthenticated = false;
    mount(HopsView);
    await flushPromises();
    expect(jamsStub.loadProfile).not.toHaveBeenCalled();
  });

  it('plays a take, and pauses the one playing', async () => {
    const wrapper = mount(HopsView);
    await rows(wrapper)[0].find('[data-test="play"]').trigger('click');
    expect(recorderStub.play).toHaveBeenCalledWith(recorder.allSaved[0]);

    recorder.isPlaying = true;
    recorder.playingId = 'take-1';
    await flushPromises();
    expect(rows(wrapper)[0].classes()).toContain('is-playing');
    await rows(wrapper)[0].find('[data-test="play"]').trigger('click');
    expect(recorderStub.stopPlayback).toHaveBeenCalled();
  });

  it('can’t play a take while recording', () => {
    recorder.isRecording = true;
    const wrapper = mount(HopsView);
    expect(rows(wrapper)[0].find('[data-test="play"]').attributes('disabled')).toBeDefined();
  });

  it('deletes a take only after you confirm', async () => {
    const wrapper = mount(HopsView);
    await rows(wrapper)[0].find('[data-test="delete"]').trigger('click');
    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.text()).toContain('“Sunday drift” will be removed from this computer');
    expect(recorderStub.delete).not.toHaveBeenCalled();

    await dialog.find('[data-test="confirm-delete"]').trigger('click');
    await flushPromises();
    expect(recorderStub.delete).toHaveBeenCalledWith('band1', 'take-1');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('Cancel keeps the take', async () => {
    const wrapper = mount(HopsView);
    await rows(wrapper)[0].find('[data-test="delete"]').trigger('click');
    await wrapper.find('[data-test="cancel-delete"]').trigger('click');
    expect(recorderStub.delete).not.toHaveBeenCalled();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('with no takes, points the way to a jam', async () => {
    recorder.allSaved = [];
    const wrapper = mount(HopsView);
    expect(wrapper.text()).toContain('No hops yet');
    await wrapper.find('[data-test="browse-public"]').trigger('click');
    expect(routerPush).toHaveBeenCalledWith({ name: 'public-jams' });
  });

  it('Edit opens the take in the hop editor', async () => {
    const wrapper = mount(HopsView);
    await rows(wrapper)[0]!.find('[data-test="edit"]').trigger('click');
    expect(routerPush).toHaveBeenCalledWith({ name: 'hop-editing', params: { jamId: 'band1', id: 'take-1' } });
  });

  describe('export', () => {
    it('each take has an Export button that exports it as a WAV', async () => {
      const wrapper = mount(HopsView);
      await rows(wrapper)[1]!.find('[data-test="export"]').trigger('click');
      expect(exportStub.exportTake).toHaveBeenCalledWith(recorder.allSaved[1]);
    });

    it('shows the take being exported, and holds the other buttons off meanwhile', async () => {
      exportStub.exportingId = 'take-1';
      const wrapper = mount(HopsView);
      expect(rows(wrapper)[0]!.find('[data-test="export"]').text()).toContain('Exporting');
      expect(rows(wrapper)[1]!.find('[data-test="export"]').attributes('disabled')).toBeDefined();
    });

    it('says where it saved, and why it didn’t', () => {
      exportStub.lastSaved = { id: 'take-1', path: '/Users/me/Sunday drift.wav' };
      exportStub.lastError = { id: 'take-2', message: 'Couldn’t load rifff B for the export' };
      const wrapper = mount(HopsView);
      expect(wrapper.text()).toContain('Saved Sunday drift.wav');
      expect(wrapper.find('[role="alert"]').text()).toContain('Couldn’t load rifff B');
    });
  });

  it('shows when each take was created in Hoppper, apart from the jam date in its name', () => {
    const wrapper = mount(HopsView);
    expect(wrapper.find('.hops__head').text()).toContain('Created');
    expect(rows(wrapper)[0]!.find('[data-test="created"]').text()).toBe('14 Sep 2026');
  });

  it('renames takes made before the naming format, once the list is in, when logged in', async () => {
    mount(HopsView);
    await flushPromises();
    expect(recorderStub.renameOldTakes).toHaveBeenCalledTimes(1);
    expect(recorderStub.loadAll.mock.invocationCallOrder[0]).toBeLessThan(recorderStub.renameOldTakes.mock.invocationCallOrder[0]!);
  });

  it('leaves old names for later when logged out — naming needs Endlesss', async () => {
    session.isAuthenticated = false;
    mount(HopsView);
    await flushPromises();
    expect(recorderStub.renameOldTakes).not.toHaveBeenCalled();
  });

  it('renames them as soon as you log in', async () => {
    session.isAuthenticated = false;
    mount(HopsView);
    await flushPromises();
    session.isAuthenticated = true;
    await flushPromises();
    expect(recorderStub.renameOldTakes).toHaveBeenCalledTimes(1);
  });
});
