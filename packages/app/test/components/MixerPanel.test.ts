import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils';
import type { RiffDocument, StemDocument } from '@hoppper/sdk';

enableAutoUnmount(afterEach);

const performanceStub = vi.hoisted(() => ({
  slotLevels: [1, 1, 1, 1, 1, 1, 1, 1],
  slotMuted: [false, false, false, false, false, false, false, false],
  slotSoloed: [false, false, false, false, false, false, false, false],
  slotAudible: [true, true, true, true, true, true, true, true],
  anySoloed: false,
  setSlotLevel: vi.fn(),
  toggleMute: vi.fn(),
  toggleSolo: vi.fn(),
  clearSolos: vi.fn(),
  meters: [0, 0, 0, 0, 0, 0, 0, 0],
  trackMeters: () => performanceStub.meters,
}));
const docs = vi.hoisted(() => new Map<string, Partial<StemDocument>>());

vi.mock('../../src/stores', () => ({
  usePerformanceStore: () => performanceStub,
  useStemDocsStore: () => ({ get: (id: string) => docs.get(id) }),
}));

import MixerPanel from '../../src/components/MixerPanel.vue';

function riff(slots: Array<string | null>): RiffDocument {
  return {
    slots: Array.from({ length: 8 }, (_, i) =>
      slots[i] ? { on: true, stemId: slots[i]!, gain: 1 } : { on: false, stemId: null, gain: 0 },
    ),
  } as RiffDocument;
}

beforeEach(() => {
  performanceStub.slotLevels = [1, 1, 1, 1, 1, 1, 1, 1];
  performanceStub.slotMuted = [false, false, false, false, false, false, false, false];
  performanceStub.slotSoloed = [false, false, false, false, false, false, false, false];
  performanceStub.slotAudible = [true, true, true, true, true, true, true, true];
  performanceStub.anySoloed = false;
  performanceStub.meters = [0, 0, 0, 0, 0, 0, 0, 0];
  performanceStub.toggleSolo.mockReset();
  performanceStub.clearSolos.mockReset();
  performanceStub.setSlotLevel.mockReset();
  performanceStub.toggleMute.mockReset();
  docs.clear();
  docs.set('d', { presetName: 'Mainline', creatorUserName: 'lwlkc', primaryColour: 'ffe07b39' });
  docs.set('b', { presetName: 'Sub', creatorUserName: 'jrc1', primaryColour: 'ff4d9de0' });
});

const channels = (w: ReturnType<typeof mount>) => w.findAll('[data-test="channel"]');

describe('MixerPanel', () => {
  it('always shows eight channels', () => {
    expect(channels(mount(MixerPanel, { props: { riff: null } }))).toHaveLength(8);
  });

  it('names each channel after its stem and who made it', () => {
    const wrapper = mount(MixerPanel, { props: { riff: riff(['d', null, 'b']) } });
    const [first, second, third] = channels(wrapper);
    expect(first!.text()).toContain('Mainline');
    expect(first!.text()).toContain('lwlkc');
    expect(third!.text()).toContain('Sub');
    expect(third!.find('[data-test="channel-name"]').attributes('style')).toContain('rgb(77 157 224)');
    expect(second!.text()).toContain('Empty');
    expect(second!.classes()).toContain('is-empty');
  });

  it('mute toggles that slot', async () => {
    const wrapper = mount(MixerPanel, { props: { riff: riff(['d']) } });
    await channels(wrapper)[0]!.find('[data-test="mute"]').trigger('click');
    expect(performanceStub.toggleMute).toHaveBeenCalledWith(0);
  });

  it('shows a muted slot as muted', () => {
    performanceStub.slotMuted[0] = true;
    const wrapper = mount(MixerPanel, { props: { riff: riff(['d']) } });
    expect(channels(wrapper)[0]!.classes()).toContain('is-muted');
    expect(channels(wrapper)[0]!.find('[data-test="mute"]').attributes('aria-pressed')).toBe('true');
  });

  it('shows each fader at its slot’s level', () => {
    performanceStub.slotLevels[2] = 0.4;
    const wrapper = mount(MixerPanel, { props: { riff: riff(['d', null, 'b']) } });
    expect(channels(wrapper)[2]!.find('[role="slider"]').attributes('aria-valuenow')).toBe('40');
  });

  it('arrow keys nudge a fader', async () => {
    performanceStub.slotLevels[0] = 0.5;
    const wrapper = mount(MixerPanel, { props: { riff: riff(['d']) } });
    const fader = channels(wrapper)[0]!.find('[role="slider"]');
    await fader.trigger('keydown', { key: 'ArrowUp' });
    expect(performanceStub.setSlotLevel).toHaveBeenLastCalledWith(0, 0.55);
    await fader.trigger('keydown', { key: 'ArrowDown' });
    expect(performanceStub.setSlotLevel).toHaveBeenLastCalledWith(0, 0.45);
  });

  it('dragging a fader sets the level from where the pointer is', async () => {
    const wrapper = mount(MixerPanel, { props: { riff: riff(['d']) } });
    const fader = channels(wrapper)[0]!.find('[role="slider"]');
    (fader.element as HTMLElement).getBoundingClientRect = () =>
      ({ top: 100, height: 150, left: 0, width: 28, bottom: 250, right: 28 }) as DOMRect;
    await fader.trigger('pointerdown', { clientY: 130 });
    expect(performanceStub.setSlotLevel).toHaveBeenLastCalledWith(0, expect.closeTo(0.8, 6));
  });

  describe('solo', () => {
    it('each channel has a Solo switch for its track', async () => {
      const wrapper = mount(MixerPanel, { props: { riff: riff(['d', null, 'b']) } });
      const solo = channels(wrapper)[2]!.find('[data-test="solo"]');
      expect(solo.attributes('aria-pressed')).toBe('false');
      await solo.trigger('click');
      expect(performanceStub.toggleSolo).toHaveBeenCalledWith(2);
    });

    it('shows which tracks are soloed, and dims the ones solo has silenced', () => {
      performanceStub.slotSoloed[0] = true;
      performanceStub.anySoloed = true;
      performanceStub.slotAudible = [true, false, false, false, false, false, false, false];
      const wrapper = mount(MixerPanel, { props: { riff: riff(['d', null, 'b']) } });
      expect(channels(wrapper)[0]!.find('[data-test="solo"]').attributes('aria-pressed')).toBe('true');
      expect(channels(wrapper)[0]!.classes()).toContain('is-soloed');
      expect(channels(wrapper)[2]!.classes()).toContain('is-silenced');
      expect(channels(wrapper)[0]!.classes()).not.toContain('is-silenced');
    });

    it('Un-solo clears every solo, and is off while nothing is soloed', async () => {
      const wrapper = mount(MixerPanel, { props: { riff: riff(['d', 'b']) } });
      expect(wrapper.find('[data-test="unsolo"]').attributes('disabled')).toBeDefined();
      performanceStub.anySoloed = true;
      const soloed = mount(MixerPanel, { props: { riff: riff(['d', 'b']) } });
      await soloed.find('[data-test="unsolo"]').trigger('click');
      expect(performanceStub.clearSolos).toHaveBeenCalledTimes(1);
    });

    it('an empty channel has nothing to solo', () => {
      const wrapper = mount(MixerPanel, { props: { riff: riff(['d', null]) } });
      expect(channels(wrapper)[1]!.find('[data-test="solo"]').attributes('disabled')).toBeDefined();
    });
  });

  describe('level meters', () => {
    const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

    it('puts a meter beside each fader, lit to that track’s level', async () => {
      performanceStub.meters = [1, 0.5, 0, 0, 0, 0, 0, 0];
      const wrapper = mount(MixerPanel, { props: { riff: riff(['d', 'b']) } });
      await nextFrame();
      await flushPromises();
      const lit = (i: number) => channels(wrapper)[i]!.findAll('[data-test="track-meter"] .is-lit').length;
      const segments = channels(wrapper)[0]!.findAll('[data-test="track-meter"] span').length;
      expect(segments).toBeGreaterThan(8);
      expect(lit(0)).toBe(segments);
      expect(lit(1)).toBe(Math.round(segments / 2));
      expect(lit(2)).toBe(0);
    });
  });
});
