import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import type { JamCouchID, RiffCouchID, RiffDocument } from '@hoppper/sdk';
import type { HopSequence } from '../../src/hop-recorder/types';

enableAutoUnmount(afterEach);

const JAM = 'band1' as JamCouchID;
const riff = (riffId: string) =>
  ({ riffId, jamId: JAM, bps: 2, barLength: 16, createdAt: 0, userName: 'lwlkc', slots: [] }) as unknown as RiffDocument;
// A, B, C arriving at 0, 8 and 16 s, the take ending at 24 s.
const take = (): HopSequence => ({
  schemaVersion: 1,
  id: 't1',
  title: 'Sunday drift',
  jamId: JAM,
  recordedAt: '2026-09-14T12:00:00.000Z',
  durationSec: 24,
  hops: ['A', 'B', 'C'].map((r, i) => ({ tSec: i === 0 ? 0 : i * 8 - 0.25, riffId: r as RiffCouchID, jamId: JAM, transitionMs: 250 })),
});

const editorStub = vi.hoisted(() => ({
  take: null as HopSequence | null,
  lastOpened: null as null | { jamId: string; id: string },
  canUndo: false,
  canRedo: false,
  lastError: null as string | null,
  open: vi.fn(),
  gridOf: () => ({ beatSec: 0.5, barSec: 2 }),
  loopSecOf: () => 4,
  skippedAt: vi.fn(),
  moveHop: vi.fn(async () => {}),
  deleteHop: vi.fn(async () => {}),
  addRiff: vi.fn(async () => {}),
  duplicate: vi.fn(async () => {}),
  undo: vi.fn(async () => {}),
  redo: vi.fn(async () => {}),
}));
const recorderStub = vi.hoisted(() => ({
  isPlaying: false,
  isRecording: false,
  position: null as number | null,
  play: vi.fn(async () => {}),
  stopPlayback: vi.fn(),
  playPosition: () => recorderStub.position,
}));

vi.mock('../../src/stores', async () => {
  const { reactive } = await import('vue');
  const editor = reactive(editorStub);
  const recorder = reactive(recorderStub);
  return {
    useHopEditorStore: () => editor,
    useRecorderStore: () => recorder,
    useRiffDocsStore: () => ({ get: (id: string) => riff(id) }),
    useStemDocsStore: () => ({ get: () => undefined, ensure: async () => {} }),
    usePerformanceStore: () => ({ bufferFor: () => undefined, decodedTick: 0, warm: vi.fn(async () => {}), stop: vi.fn() }),
    useJamsStore: () => ({ profilesById: new Map([['band1', { displayName: 'Hoppper' }]]), loadProfile: vi.fn(async () => {}) }),
    __editor: editor,
    __recorder: recorder,
  };
});

vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRoute: () => ({ params: { jamId: 'band1', id: 't1' } }),
}));

import * as stores from '../../src/stores';
import HopEditingView from '../../src/views/HopEditingView.vue';

const editor = (stores as unknown as { __editor: typeof editorStub }).__editor;
const recorder = (stores as unknown as { __recorder: typeof recorderStub }).__recorder;

beforeEach(() => {
  editor.take = take();
  editor.canUndo = false;
  editor.canRedo = false;
  editor.lastError = null;
  for (const fn of [editorStub.moveHop, editorStub.deleteHop, editorStub.addRiff, editorStub.duplicate, editorStub.undo, editorStub.redo]) {
    fn.mockReset().mockResolvedValue(undefined);
  }
  editorStub.open.mockReset().mockResolvedValue(undefined);
  editorStub.skippedAt.mockReset().mockResolvedValue([riff('X'), riff('Y')]);
  recorder.isPlaying = false;
  recorder.position = null;
  recorderStub.play.mockReset().mockResolvedValue(undefined);
  recorderStub.stopPlayback.mockReset();
});

const find = (w: ReturnType<typeof mount>, t: string) => w.find(`[data-test="${t}"]`);
const all = (w: ReturnType<typeof mount>, t: string) => w.findAll(`[data-test="${t}"]`);
const pin = (w: ReturnType<typeof mount>, num: number) => all(w, 'hop-point').find((p) => p.text() === String(num))!;

async function mounted() {
  const wrapper = mount(HopEditingView);
  await flushPromises();
  return wrapper;
}

describe('HopEditingView', () => {
  it('opens the take named in the route', async () => {
    await mounted();
    expect(editorStub.open).toHaveBeenCalledWith('band1', 't1');
  });

  it('shows the take: its title, jam, hops and length', async () => {
    const wrapper = await mounted();
    expect(wrapper.text()).toContain('Sunday drift');
    expect(find(wrapper, 'take-meta').text()).toContain('Hoppper');
    expect(find(wrapper, 'take-meta').text()).toContain('3 hops');
    expect(find(wrapper, 'take-meta').text()).toContain('0:24');
  });

  it('lays out a block per rifff and a numbered point per hop', async () => {
    const wrapper = await mounted();
    expect(all(wrapper, 'block').filter((b) => b.classes().includes('is-seg'))).toHaveLength(3);
    expect(all(wrapper, 'hop-point').map((p) => p.text())).toEqual(['1', '2']);
  });

  it('selecting a hop point splits the lanes and offers Delete and Expand', async () => {
    const wrapper = await mounted();
    expect(find(wrapper, 'delete-point').exists()).toBe(false);
    await pin(wrapper, 1).trigger('click');
    expect(pin(wrapper, 1).classes()).toContain('is-selected');
    expect(all(wrapper, 'block').filter((b) => b.classes().includes('is-ghost'))).toHaveLength(2);
    await find(wrapper, 'delete-point').trigger('click');
    expect(editorStub.deleteHop).toHaveBeenCalledWith(1);
  });

  it('dragging a hop point moves it, snapped to the beat, when it is let go', async () => {
    const wrapper = await mounted();
    const p = pin(wrapper, 1);
    await p.trigger('pointerdown', { clientX: 500 });
    const pxPerSec = Number(wrapper.find('[data-test="timeline"]').attributes('data-px-per-sec'));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 500 - 1.1 * pxPerSec }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 500 - 1.1 * pxPerSec }));
    await flushPromises();
    expect(editorStub.moveHop).toHaveBeenCalledWith(1, expect.closeTo(6.9, 6), 'beat');
  });

  it('snaps to bars, or not at all, when switched', async () => {
    const wrapper = await mounted();
    await find(wrapper, 'snap-bar').trigger('click');
    const pxPerSec = Number(wrapper.find('[data-test="timeline"]').attributes('data-px-per-sec'));
    await pin(wrapper, 1).trigger('pointerdown', { clientX: 500 });
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 500 - 0.9 * pxPerSec }));
    await flushPromises();
    expect(editorStub.moveHop).toHaveBeenLastCalledWith(1, expect.closeTo(7.1, 6), 'bar');
    await find(wrapper, 'snap-off').trigger('click');
    await pin(wrapper, 1).trigger('pointerdown', { clientX: 500 });
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 500 - 0.9 * pxPerSec }));
    await flushPromises();
    expect(editorStub.moveHop).toHaveBeenLastCalledWith(1, expect.closeTo(7.1, 6), 'off');
  });

  it('a click on a hop point without moving it doesn’t count as an edit', async () => {
    const wrapper = await mounted();
    await pin(wrapper, 1).trigger('pointerdown', { clientX: 500 });
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 501 }));
    await flushPromises();
    expect(editorStub.moveHop).not.toHaveBeenCalled();
  });

  it('picking a rifff offers Duplicate', async () => {
    const wrapper = await mounted();
    await all(wrapper, 'block')[1]!.trigger('click');
    await find(wrapper, 'duplicate').trigger('click');
    expect(editorStub.duplicate).toHaveBeenCalledWith(1);
  });

  it('Expand shows the rifffs the hop skipped; picking one and Add puts it in', async () => {
    const wrapper = await mounted();
    await pin(wrapper, 1).trigger('click');
    await find(wrapper, 'expand').trigger('click');
    await flushPromises();
    expect(editorStub.skippedAt).toHaveBeenCalledWith(1);
    const skipped = all(wrapper, 'block').filter((b) => b.classes().includes('is-skip'));
    expect(skipped).toHaveLength(2);
    expect(find(wrapper, 'add').attributes('disabled')).toBeDefined();
    await skipped[1]!.trigger('click');
    await find(wrapper, 'add').trigger('click');
    expect(editorStub.addRiff).toHaveBeenCalledWith(1, 'Y');
  });

  it('says so when a hop skipped nothing', async () => {
    editorStub.skippedAt.mockResolvedValue([]);
    const wrapper = await mounted();
    await pin(wrapper, 1).trigger('click');
    await find(wrapper, 'expand').trigger('click');
    await flushPromises();
    expect(find(wrapper, 'hint').text()).toContain('skipped nothing');
  });

  it('undo and redo, by button and by keyboard', async () => {
    editor.canUndo = true;
    editor.canRedo = true;
    const wrapper = await mounted();
    await find(wrapper, 'undo').trigger('click');
    expect(editorStub.undo).toHaveBeenCalledTimes(1);
    await find(wrapper, 'redo').trigger('click');
    expect(editorStub.redo).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true }));
    expect(editorStub.undo).toHaveBeenCalledTimes(2);
    expect(editorStub.redo).toHaveBeenCalledTimes(2);
  });

  it('Play plays the take from the start, with a playhead across the timeline', async () => {
    const wrapper = await mounted();
    await find(wrapper, 'play-take').trigger('click');
    expect(recorderStub.play).toHaveBeenCalledWith(editor.take);
    recorder.isPlaying = true;
    recorder.position = 4;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await flushPromises();
    expect(find(wrapper, 'take-playhead').exists()).toBe(true);
  });

  it('shows a save failure', async () => {
    editor.lastError = 'Couldn’t save the hop: disk full';
    const wrapper = await mounted();
    expect(wrapper.text()).toContain('disk full');
  });
});
