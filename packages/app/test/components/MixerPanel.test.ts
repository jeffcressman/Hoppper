import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, enableAutoUnmount } from '@vue/test-utils';
import type { RiffDocument, StemDocument } from '@hoppper/sdk';

enableAutoUnmount(afterEach);

const performanceStub = vi.hoisted(() => ({
  slotLevels: [1, 1, 1, 1, 1, 1, 1, 1],
  slotMuted: [false, false, false, false, false, false, false, false],
  setSlotLevel: vi.fn(),
  toggleMute: vi.fn(),
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
});
