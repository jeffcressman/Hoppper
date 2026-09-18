import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';

enableAutoUnmount(afterEach);

const performanceStub = vi.hoisted(() => ({
  state: 'idle' as 'idle' | 'playing',
  quantiseEntry: false,
  canResume: false,
  stop: vi.fn(),
  resume: vi.fn(async () => null),
  levels: vi.fn((): [number, number] => [0, 0]),
}));
const recorderStub = vi.hoisted(() => ({
  isRecording: false,
  isArmed: false,
  isPlaying: false,
  start: vi.fn(),
  stop: vi.fn(async () => null),
  stopPlayback: vi.fn(),
}));

vi.mock('../../src/stores', async () => {
  const { reactive } = await import('vue');
  const performance = reactive(performanceStub);
  const recorder = reactive(recorderStub);
  return {
    usePerformanceStore: () => performance,
    useRecorderStore: () => recorder,
    __performance: performance,
    __recorder: recorder,
  };
});

const route = vi.hoisted(() => ({ name: 'hop-recording' as string, params: { jamId: 'band1' } as Record<string, string> }));
vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRoute: () => route,
}));

import * as stores from '../../src/stores';
import TransportBar from '../../src/components/TransportBar.vue';

const performance = (stores as unknown as { __performance: typeof performanceStub }).__performance;
const recorder = (stores as unknown as { __recorder: typeof recorderStub }).__recorder;

beforeEach(() => {
  performance.state = 'idle';
  performance.quantiseEntry = false;
  performance.canResume = false;
  performanceStub.stop.mockReset();
  performanceStub.resume.mockReset().mockResolvedValue(null);
  performanceStub.levels.mockReset().mockReturnValue([0, 0]);
  recorder.isRecording = false;
  recorder.isArmed = false;
  recorder.isPlaying = false;
  recorderStub.start.mockReset();
  recorderStub.stop.mockReset().mockResolvedValue(null);
  recorderStub.stopPlayback.mockReset();
  route.name = 'hop-recording';
  route.params = { jamId: 'band1' };
});

const btn = (w: ReturnType<typeof mount>, t: string) => w.find(`[data-test="${t}"]`);
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe('TransportBar — stop and play', () => {
  it('Stop is off while nothing is playing', () => {
    expect(btn(mount(TransportBar), 'stop').attributes('disabled')).toBeDefined();
  });

  it('Stop silences what is playing', async () => {
    performance.state = 'playing';
    const wrapper = mount(TransportBar);
    await btn(wrapper, 'stop').trigger('click');
    expect(performanceStub.stop).toHaveBeenCalled();
  });

  it('Stop during a replay cancels the rest of it, not just the audio', async () => {
    performance.state = 'playing';
    recorder.isPlaying = true;
    const wrapper = mount(TransportBar);
    await btn(wrapper, 'stop').trigger('click');
    expect(recorderStub.stopPlayback).toHaveBeenCalled();
    expect(performanceStub.stop).toHaveBeenCalled();
  });

  it('Stop is offered while a replay is still loading, before any audio', () => {
    recorder.isPlaying = true;
    expect(btn(mount(TransportBar), 'stop').attributes('disabled')).toBeUndefined();
  });

  it('Stop while recording ends the recording too, and saves it', async () => {
    performance.state = 'playing';
    recorder.isRecording = true;
    const wrapper = mount(TransportBar);
    await btn(wrapper, 'stop').trigger('click');
    await flushPromises();
    expect(performanceStub.stop).toHaveBeenCalled();
    expect(recorderStub.stop).toHaveBeenCalled();
  });

  it('Play is off until something has played', () => {
    expect(btn(mount(TransportBar), 'play').attributes('disabled')).toBeDefined();
  });

  it('Play starts the last rifff again after a stop', async () => {
    performance.canResume = true;
    const wrapper = mount(TransportBar);
    await btn(wrapper, 'play').trigger('click');
    expect(performanceStub.resume).toHaveBeenCalled();
  });

  it('Play is lit while playing', () => {
    performance.state = 'playing';
    expect(btn(mount(TransportBar), 'play').classes()).toContain('lw-iconbtn--active');
  });
});

describe('TransportBar — recording', () => {
  it('Record needs a jam, so it is off anywhere but Hop Recording', () => {
    route.name = 'hops';
    route.params = {};
    expect(btn(mount(TransportBar), 'record').attributes('disabled')).toBeDefined();
  });

  it('Record starts a take in the open jam, silencing what plays first', async () => {
    performance.state = 'playing';
    recorder.isPlaying = true;
    const wrapper = mount(TransportBar);
    await btn(wrapper, 'record').trigger('click');
    expect(recorderStub.start).toHaveBeenCalledWith('band1');
    // Every take starts on a cold start, on a fresh grid.
    expect(performanceStub.stop.mock.invocationCallOrder[0]).toBeLessThan(recorderStub.start.mock.invocationCallOrder[0]!);
    expect(recorderStub.stopPlayback.mock.invocationCallOrder[0]).toBeLessThan(recorderStub.start.mock.invocationCallOrder[0]!);
  });

  it('while recording, Record is lit and pressing it again ends the take', async () => {
    recorder.isRecording = true;
    const wrapper = mount(TransportBar);
    expect(btn(wrapper, 'record').classes()).toContain('is-recording');
    await btn(wrapper, 'record').trigger('click');
    await flushPromises();
    expect(recorderStub.stop).toHaveBeenCalled();
  });

  it('while armed, says it is waiting for the first rifff, with no clock', () => {
    recorder.isRecording = true;
    recorder.isArmed = true;
    const wrapper = mount(TransportBar);
    expect(btn(wrapper, 'recording-waiting').text()).toBe('Waiting for first rifff…');
    expect(btn(wrapper, 'recording-elapsed').exists()).toBe(false);
  });

  it('starts the clock at the first rifff, not at Record', async () => {
    vi.useFakeTimers();
    try {
      recorder.isRecording = true;
      recorder.isArmed = true;
      const wrapper = mount(TransportBar);
      vi.advanceTimersByTime(5000);
      recorder.isArmed = false;
      await flushPromises();
      expect(btn(wrapper, 'recording-elapsed').text()).toContain('0:00');
      vi.advanceTimersByTime(1500);
      await flushPromises();
      expect(btn(wrapper, 'recording-elapsed').text()).toContain('0:01');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows no clock when not recording', () => {
    expect(btn(mount(TransportBar), 'recording-elapsed').exists()).toBe(false);
  });
});

describe('TransportBar — quantise and meter', () => {
  it('Quantise shows and flips whether hops wait for the beat', async () => {
    const wrapper = mount(TransportBar);
    expect(btn(wrapper, 'quantise').attributes('aria-pressed')).toBe('false');
    await btn(wrapper, 'quantise').trigger('click');
    expect(performance.quantiseEntry).toBe(true);
    expect(btn(wrapper, 'quantise').attributes('aria-pressed')).toBe('true');
  });

  it('lights the meter to the output level of each channel', async () => {
    performanceStub.levels.mockReturnValue([0.5, 1]);
    const wrapper = mount(TransportBar);
    await nextFrame();
    await flushPromises();
    const lit = (row: number) =>
      wrapper.findAll('[data-test="meter-row"]')[row]!.findAll('.is-lit').length;
    expect(lit(0)).toBe(9);
    expect(lit(1)).toBe(18);
  });
});
