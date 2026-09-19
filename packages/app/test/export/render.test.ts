import { describe, it, expect, vi } from 'vitest';
import type { JamCouchID, RiffCouchID, RiffDocument } from '@hoppper/sdk';
import type { HopSequence } from '../../src/hop-recorder/types';
import { renderTake } from '../../src/export/render';

const JAM = 'band1' as JamCouchID;
const take: HopSequence = {
  schemaVersion: 1,
  id: 't1',
  title: 'Take',
  jamId: JAM,
  recordedAt: '',
  durationSec: 2,
  hops: [
    { tSec: 0, riffId: 'A' as RiffCouchID, jamId: JAM, transitionMs: 250 },
    { tSec: 1.2, riffId: 'B' as RiffCouchID, jamId: JAM, transitionMs: 100, quantise: 'beat' },
    { tSec: 1.6, riffId: 'A' as RiffCouchID, jamId: JAM, transitionMs: 250 },
  ],
};

function setup(opts: { notReady?: string } = {}) {
  const calls: string[] = [];
  const rendered = { numberOfChannels: 2, sampleRate: 100, getChannelData: (c: number) => new Float32Array(200).fill(c ? -0.5 : 0.5) };
  const context = { startRendering: vi.fn(async () => {
    calls.push('render');
    return rendered;
  }) };
  const engine = {
    warmRiff: vi.fn(async (_j: string, r: RiffDocument) => {
      calls.push(`warm ${r.riffId}`);
    }),
    hopTo: vi.fn(async (_j: string, r: RiffDocument, _s: unknown, o: { atSec: number }) => {
      calls.push(`hop ${r.riffId}@${o.atSec}`);
      return r.riffId === opts.notReady
        ? { kind: 'not-ready' as const, missingStemIds: [] }
        : { kind: 'started' as const, riffId: r.riffId, whenSec: o.atSec, atSec: o.atSec };
    }),
  };
  const createContext = vi.fn(() => context);
  const deps = {
    sampleRate: 100,
    createContext,
    createEngine: vi.fn(() => engine),
    resolveRiff: vi.fn(async (_j: JamCouchID, id: RiffCouchID) => ({ riff: { riffId: id } as RiffDocument, stems: [] })),
  };
  return { deps, engine, calls, createContext };
}

describe('renderTake', () => {
  it('renders a stereo buffer exactly as long as the take', async () => {
    const { deps, createContext } = setup();
    const out = await renderTake(take, deps as never);
    expect(createContext).toHaveBeenCalledWith(200, 100);
    expect(out.sampleRate).toBe(100);
    expect(out.channels).toHaveLength(2);
    expect(out.channels[1]![0]).toBe(-0.5);
  });

  it('loads every rifff first, once each, then lays each hop out at its time, then renders', async () => {
    const { deps, calls } = setup();
    await renderTake(take, deps as never);
    expect(calls).toEqual(['warm A', 'warm B', 'hop A@0', 'hop B@1.2', 'hop A@1.6', 'render']);
    expect(deps.resolveRiff).toHaveBeenCalledTimes(2);
  });

  it('keeps each hop’s crossfade and quantise, as replay does', async () => {
    const { deps, engine } = setup();
    await renderTake(take, deps as never);
    expect(engine.hopTo.mock.calls[1]![3]).toEqual({ crossfadeMs: 100, quantise: 'beat', atSec: 1.2 });
  });

  it('fails, rather than rendering a gap, when a rifff can’t be loaded', async () => {
    const { deps } = setup({ notReady: 'B' });
    await expect(renderTake(take, deps as never)).rejects.toThrow(/B/);
  });
});
