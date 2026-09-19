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
  resizeStart: vi.fn(async () => {}),
  resizeEnd: vi.fn(async () => {}),
  addAutomationPoint: vi.fn(async () => {}),
  moveAutomationPoint: vi.fn(async () => {}),
  removeAutomationPoint: vi.fn(async () => {}),
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

// Rifff documents not fetched yet. Reactive, so the page sees them arrive.
const riffDocsState = vi.hoisted(() => ({ missing: new Set<string>() }));

const performanceStub = vi.hoisted(() => ({
  bufferFor: () => undefined,
  decodedTick: 0,
  warm: vi.fn(async (_jamId: string, _riff: { riffId: string }) => {}),
  stop: vi.fn(),
  useMix: vi.fn(),
}));

vi.mock('../../src/stores', async () => {
  const { reactive } = await import('vue');
  riffDocsState.missing = reactive(new Set<string>()) as Set<string>;
  const editor = reactive(editorStub);
  const recorder = reactive(recorderStub);
  return {
    useHopEditorStore: () => editor,
    useRecorderStore: () => recorder,
    useRiffDocsStore: () => ({ get: (id: string) => (riffDocsState.missing.has(id) ? undefined : riff(id)) }),
    useStemDocsStore: () => ({ get: () => undefined, ensure: async () => {} }),
    usePerformanceStore: () => performanceStub,
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
import { laneGeometry } from '../../src/hop-editor/layout';

const editor = (stores as unknown as { __editor: typeof editorStub }).__editor;
const recorder = (stores as unknown as { __recorder: typeof recorderStub }).__recorder;

beforeEach(() => {
  riffDocsState.missing.clear();
  performanceStub.warm.mockClear();
  editor.take = take();
  editor.canUndo = false;
  editor.canRedo = false;
  editor.lastError = null;
  for (const fn of [editorStub.moveHop, editorStub.deleteHop, editorStub.addRiff, editorStub.duplicate, editorStub.resizeStart, editorStub.resizeEnd, editorStub.addAutomationPoint, editorStub.moveAutomationPoint, editorStub.removeAutomationPoint, editorStub.undo, editorStub.redo]) {
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

  it('fills the timeline’s height with the lanes — both of them, once split', async () => {
    const tall = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.test === 'timeline' ? 700 : 0;
      },
    });
    try {
      const wrapper = await mounted();
      const blockHeight = () => parseFloat((all(wrapper, 'block')[0]!.element as HTMLElement).style.height);
      expect(blockHeight()).toBe(laneGeometry(700, false).laneH);
      await pin(wrapper, 1).trigger('click');
      expect(blockHeight()).toBe(laneGeometry(700, true).laneH);
      expect(blockHeight()).toBeGreaterThan(200);
    } finally {
      if (tall) Object.defineProperty(HTMLElement.prototype, 'clientHeight', tall);
    }
  });

  it('plays with its own mix: the rifffs as committed, not the recording page’s mutes', async () => {
    performanceStub.useMix.mockClear();
    await mounted();
    expect(performanceStub.useMix).toHaveBeenCalledWith('editor');
  });

  describe('the take’s start and end handles', () => {
    const pxPerSecOf = (w: ReturnType<typeof mount>) => Number(w.find('[data-test="timeline"]').attributes('data-px-per-sec'));
    const drag = async (el: ReturnType<ReturnType<typeof mount>['find']>, fromX: number, toX: number) => {
      await el.trigger('pointerdown', { clientX: fromX });
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: toX }));
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: toX }));
      await flushPromises();
    };

    it('drags the end right to let the last rifff play on', async () => {
      const wrapper = await mounted();
      const px = pxPerSecOf(wrapper);
      await drag(find(wrapper, 'take-end'), 900, 900 + 6.1 * px);
      expect(editorStub.resizeEnd).toHaveBeenCalledWith(expect.closeTo(30.1, 6), 'beat');
    });

    it('drags the start left to grow the first rifff into the past', async () => {
      const wrapper = await mounted();
      const px = pxPerSecOf(wrapper);
      await drag(find(wrapper, 'take-start'), 100, 100 - 4 * px);
      expect(editorStub.resizeStart).toHaveBeenCalledWith(expect.closeTo(4, 6), 'beat');
    });

    it('a click on a handle isn’t an edit', async () => {
      const wrapper = await mounted();
      await drag(find(wrapper, 'take-end'), 900, 901);
      expect(editorStub.resizeEnd).not.toHaveBeenCalled();
    });

    it('hides the handles while expanded, where the take’s ends are not where they appear', async () => {
      const wrapper = await mounted();
      await pin(wrapper, 1).trigger('click');
      await find(wrapper, 'expand').trigger('click');
      await flushPromises();
      expect(find(wrapper, 'take-start').exists()).toBe(false);
      expect(find(wrapper, 'take-end').exists()).toBe(false);
    });

    it('marks each loop inside a rifff, so its repeats show as it is stretched', async () => {
      // C runs from 16 s to 40 s; its loop is 16 s, so a new copy starts at 32 s.
      editor.take = { ...take(), durationSec: 40 };
      const wrapper = await mounted();
      const blocks = all(wrapper, 'block').filter((b) => b.classes().includes('is-seg'));
      expect(blocks[2]!.findAll('[data-test="loop-line"]')).toHaveLength(1);
      expect(blocks[0]!.findAll('[data-test="loop-line"]')).toHaveLength(0);
    });
  });

  it('leaving the editor stops its playback', async () => {
    const wrapper = await mounted();
    recorder.isPlaying = true;
    wrapper.unmount();
    expect(recorderStub.stopPlayback).toHaveBeenCalled();
  });

  it('leaving while nothing plays stops nothing', async () => {
    const wrapper = await mounted();
    wrapper.unmount();
    expect(recorderStub.stopPlayback).not.toHaveBeenCalled();
  });

  describe('scrolling while the end handle is dragged', () => {
    function sizeTimeline(el: HTMLElement, visibleWidth: number) {
      Object.defineProperty(el, 'clientWidth', { configurable: true, value: visibleWidth });
      el.getBoundingClientRect = () => ({ left: 0, right: visibleWidth, top: 0, bottom: 400, width: visibleWidth, height: 400 }) as DOMRect;
    }
    const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

    it('follows the end out of view as it is dragged right', async () => {
      const wrapper = await mounted();
      const tl = find(wrapper, 'timeline').element as HTMLElement;
      sizeTimeline(tl, 300);
      const px = Number(tl.dataset.pxPerSec);
      await find(wrapper, 'take-end').trigger('pointerdown', { clientX: 280 });
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 280 + 4 * px }));
      await flushPromises();
      // The new end (28 s) sits past the 300 px view: it has scrolled to it.
      expect(tl.scrollLeft).toBeGreaterThan(0);
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 280 + 4 * px }));
    });

    it('keeps extending while the pointer is held at the edge, counting the scroll', async () => {
      const wrapper = await mounted();
      const tl = find(wrapper, 'timeline').element as HTMLElement;
      sizeTimeline(tl, 300);
      await find(wrapper, 'take-end').trigger('pointerdown', { clientX: 280 });
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 298 }));
      for (let i = 0; i < 5; i++) await nextFrame();
      const scrolled = tl.scrollLeft;
      expect(scrolled).toBeGreaterThan(0);
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 298 }));
      await flushPromises();
      const px = Number(tl.dataset.pxPerSec);
      expect(editorStub.resizeEnd).toHaveBeenCalledWith(expect.closeTo(24 + (18 + scrolled) / px, 6), 'beat');
    });
  });

  it('loads each rifff’s audio for the lanes once its document arrives, even after the take opened', async () => {
    // Opened from the Hops page before the take's rifff documents are in.
    for (const id of ['A', 'B', 'C']) riffDocsState.missing.add(id);
    await mounted();
    expect(performanceStub.warm).not.toHaveBeenCalled();
    riffDocsState.missing.clear();
    await flushPromises();
    expect(performanceStub.warm.mock.calls.map((c) => c[1].riffId).sort()).toEqual(['A', 'B', 'C']);
  });

  it('loads each rifff once, however often the take changes', async () => {
    await mounted();
    const loads = performanceStub.warm.mock.calls.length;
    editor.take = { ...take(), durationSec: 30 };
    await flushPromises();
    expect(performanceStub.warm.mock.calls.length).toBe(loads);
  });

  describe('automation', () => {
    // Unmeasured, the lane is its minimum 128 px: eight 16 px track rows,
    // each drawn 3 px in from its edges.
    const ROW_H = 16;
    const PAD = 3;
    const yFor = (slot: number, value: number) => slot * ROW_H + PAD + (1 - value) * (ROW_H - 2 * PAD);
    const pxPerSecOf = (w: ReturnType<typeof mount>) => Number(w.find('[data-test="timeline"]').attributes('data-px-per-sec'));

    async function automating(param?: 'mute' | 'solo') {
      const wrapper = await mounted();
      await find(wrapper, 'automation-toggle').trigger('click');
      if (param) await find(wrapper, `auto-param-${param}`).trigger('click');
      return wrapper;
    }

    it('Automation shows a line for each of the eight tracks, volume first', async () => {
      const wrapper = await automating();
      expect(find(wrapper, 'automation-toggle').attributes('aria-pressed')).toBe('true');
      expect(all(wrapper, 'auto-row')).toHaveLength(8);
      expect(all(wrapper, 'auto-line')).toHaveLength(8);
      expect(find(wrapper, 'auto-param-volume').attributes('aria-pressed')).toBe('true');
    });

    it('sets hop editing aside while it’s on', async () => {
      const wrapper = await automating();
      expect(pin(wrapper, 1).attributes('disabled')).toBeDefined();
      expect(find(wrapper, 'take-start').exists()).toBe(false);
      expect(find(wrapper, 'take-end').exists()).toBe(false);
    });

    it('a click on a track’s line adds a point there, at that time and height', async () => {
      const wrapper = await automating();
      const px = pxPerSecOf(wrapper);
      await all(wrapper, 'auto-row')[2]!.trigger('click', { clientX: 5 * px, clientY: yFor(2, 0.5) });
      expect(editorStub.addAutomationPoint).toHaveBeenCalledWith(2, 'volume', expect.closeTo(5, 6), expect.closeTo(0.5, 6));
    });

    it('for mute and solo, a click in a track’s upper half is on, lower half off', async () => {
      const wrapper = await automating('mute');
      await all(wrapper, 'auto-row')[0]!.trigger('click', { clientX: 32, clientY: yFor(0, 0.9) });
      expect(editorStub.addAutomationPoint).toHaveBeenLastCalledWith(0, 'mute', 2, 1);
      await all(wrapper, 'auto-row')[0]!.trigger('click', { clientX: 32, clientY: yFor(0, 0.1) });
      expect(editorStub.addAutomationPoint).toHaveBeenLastCalledWith(0, 'mute', 2, 0);
    });

    it('shows the points recorded on the take, and double-click removes one', async () => {
      editor.take = {
        ...take(),
        automation: Array.from({ length: 8 }, (_, i) => ({
          volume: i === 1 ? [{ tSec: 2, value: 1 }, { tSec: 10, value: 0.2 }] : [],
          mute: [],
          solo: [],
        })),
      };
      const wrapper = await automating();
      const points = all(wrapper, 'auto-point');
      expect(points).toHaveLength(2);
      await points[1]!.trigger('dblclick');
      expect(editorStub.removeAutomationPoint).toHaveBeenCalledWith(1, 'volume', 1);
    });

    it('dragging a point moves it, in time and value', async () => {
      editor.take = {
        ...take(),
        automation: Array.from({ length: 8 }, (_, i) => ({
          volume: i === 1 ? [{ tSec: 2, value: 1 }] : [],
          mute: [],
          solo: [],
        })),
      };
      const wrapper = await automating();
      const px = pxPerSecOf(wrapper);
      await find(wrapper, 'auto-point').trigger('pointerdown', { clientX: 2 * px, clientY: yFor(1, 1) });
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 4 * px, clientY: yFor(1, 0.5) }));
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 4 * px, clientY: yFor(1, 0.5) }));
      await flushPromises();
      expect(editorStub.moveAutomationPoint).toHaveBeenCalledWith(1, 'volume', 0, expect.closeTo(4, 6), expect.closeTo(0.5, 6));
    });
  });

  describe('zoom and scrolling', () => {
    const pxOf = (w: ReturnType<typeof mount>) => Number(w.find('[data-test="timeline"]').attributes('data-px-per-sec'));
    const blockHeight = (w: ReturnType<typeof mount>) => parseFloat((all(w, 'block')[0]!.element as HTMLElement).style.height);
    function sizeTimeline(el: HTMLElement, width: number) {
      Object.defineProperty(el, 'clientWidth', { configurable: true, value: width });
      el.getBoundingClientRect = () => ({ left: 0, right: width, top: 0, bottom: 400, width, height: 400 }) as DOMRect;
    }

    it('zooms time in and out', async () => {
      const wrapper = await mounted();
      const start = pxOf(wrapper);
      await find(wrapper, 'zoom-in').trigger('click');
      expect(pxOf(wrapper)).toBeCloseTo(start * 1.5, 6);
      await find(wrapper, 'zoom-out').trigger('click');
      await find(wrapper, 'zoom-out').trigger('click');
      expect(pxOf(wrapper)).toBeCloseTo(start / 1.5, 6);
    });

    it('stops at sensible limits', async () => {
      const wrapper = await mounted();
      for (let i = 0; i < 30; i++) await find(wrapper, 'zoom-in').trigger('click');
      const most = pxOf(wrapper);
      await find(wrapper, 'zoom-in').trigger('click');
      expect(pxOf(wrapper)).toBe(most);
      expect(find(wrapper, 'zoom-in').attributes('disabled')).toBeDefined();
    });

    it('Fit shows the whole take across the view', async () => {
      const wrapper = await mounted();
      sizeTimeline(find(wrapper, 'timeline').element as HTMLElement, 600);
      await find(wrapper, 'zoom-fit').trigger('click');
      // 24 s across what's left of 600 px after the margins.
      const px = pxOf(wrapper);
      expect(24 * px).toBeLessThanOrEqual(600);
      expect(24 * px).toBeGreaterThan(450);
    });

    it('Ctrl/Cmd + wheel zooms time around the pointer, keeping that moment under it', async () => {
      const wrapper = await mounted();
      const tl = find(wrapper, 'timeline').element as HTMLElement;
      sizeTimeline(tl, 600);
      tl.scrollLeft = 100;
      const px = pxOf(wrapper);
      const pointerX = 300;
      const before = (tl.scrollLeft + pointerX) / px;
      await find(wrapper, 'timeline').trigger('wheel', { deltaY: -100, ctrlKey: true, clientX: pointerX });
      await flushPromises();
      const after = pxOf(wrapper);
      expect(after).toBeGreaterThan(px);
      // Allow for the timeline's 20 px left margin.
      expect((tl.scrollLeft + pointerX - 20) / after).toBeCloseTo((before * px - 20) / px, 1);
    });

    it('makes tracks taller and shorter — taller than the view scrolls', async () => {
      const wrapper = await mounted();
      const start = blockHeight(wrapper);
      await find(wrapper, 'taller').trigger('click');
      expect(blockHeight(wrapper)).toBeGreaterThan(start);
      await find(wrapper, 'shorter').trigger('click');
      expect(blockHeight(wrapper)).toBe(start);
      expect(find(wrapper, 'shorter').attributes('disabled')).toBeDefined();
    });

    it('Alt + wheel makes tracks taller', async () => {
      const wrapper = await mounted();
      const start = blockHeight(wrapper);
      await find(wrapper, 'timeline').trigger('wheel', { deltaY: -100, altKey: true });
      await flushPromises();
      expect(blockHeight(wrapper)).toBeGreaterThan(start);
    });

    it('keeps the ruler and hop points in view while scrolling down', async () => {
      const wrapper = await mounted();
      expect(find(wrapper, 'timeline-head').exists()).toBe(true);
      expect(find(wrapper, 'timeline-head').findAll('[data-test="hop-point"]')).toHaveLength(2);
    });
  });
});
