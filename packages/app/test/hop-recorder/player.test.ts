import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  JamCouchID,
  ResolvedStem,
  RiffCouchID,
  RiffDocument,
  StemCouchID,
} from '@hoppper/sdk';
import {
  createHopPlayer,
  type RiffResolver,
  type PlayerScheduler,
} from '../../src/hop-recorder/player.js';
import type { AudioEngine, HopResult } from '../../src/audio/engine.js';
import type { HopSequence } from '../../src/hop-recorder/types.js';

const JAM = 'band-test' as JamCouchID;

function riff(id: string): RiffDocument {
  return {
    riffId: id as RiffCouchID,
    jamId: JAM,
    userName: 'u',
    createdAt: 0,
    bps: 2,
    bpm: 120,
    barLength: 16,
    root: 0,
    scale: 0,
    slots: [],
  };
}

function stem(id: string): ResolvedStem {
  return {
    stemId: id as StemCouchID,
    format: 'ogg',
    url: '',
    length: 0,
    mime: 'audio/ogg',
  };
}

function sequence(): HopSequence {
  return {
    schemaVersion: 1,
    id: 'seq',
    title: 't',
    jamId: JAM,
    recordedAt: '',
    durationSec: 30,
    hops: [
      { tSec: 0, riffId: 'r1', jamId: JAM, transitionMs: 0 },
      { tSec: 10, riffId: 'r2', jamId: JAM, transitionMs: 250 },
      { tSec: 20, riffId: 'r3', jamId: JAM, transitionMs: 250 },
    ],
  };
}

interface MockEngine extends AudioEngine {
  hopTo: ReturnType<typeof vi.fn>;
  warmRiff: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function mockEngine(): MockEngine {
  const eng = {
    state: 'idle' as const,
    currentRiffId: null,
    now: vi.fn(() => 0),
    warmRiff: vi.fn(async () => {}),
    hopTo: vi.fn(
      async (_j, r: RiffDocument): Promise<HopResult> => ({
        kind: 'started',
        riffId: r.riffId,
        whenSec: 0,
      }),
    ),
    stop: vi.fn(),
    onStateChange: () => () => {},
  };
  return eng as unknown as MockEngine;
}

interface FakeScheduler extends PlayerScheduler {
  pending: { delayMs: number; fn: () => void; cancelled: boolean }[];
  advance(ms: number): Promise<void>;
}

function fakeScheduler(clock: { t: number }): FakeScheduler {
  const pending: FakeScheduler['pending'] = [];
  return {
    pending,
    schedule(delayMs, fn) {
      const entry = { delayMs, fn, cancelled: false };
      pending.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    async advance(ms: number) {
      clock.t += ms / 1000;
      // Fire any pending whose delay has elapsed (cooperative — players
      // typically schedule one at a time, so this loop is fine).
      const due = pending.filter((p) => !p.cancelled && p.delayMs <= ms);
      for (const p of due) {
        p.cancelled = true;
        p.fn();
        // Let microtasks flush so the player can schedule the next hop.
        await Promise.resolve();
        await Promise.resolve();
      }
    },
  };
}

let engine: MockEngine;
let resolveRiff: RiffResolver;

beforeEach(() => {
  engine = mockEngine();
  resolveRiff = vi.fn(async (_j, id) => ({
    riff: riff(id),
    stems: [stem(`${id}-s`)],
  }));
});

describe('createHopPlayer', () => {
  it('idle before play()', () => {
    const clock = { t: 0 };
    const player = createHopPlayer({
      engine,
      resolveRiff,
      clock: () => clock.t,
      scheduler: fakeScheduler(clock),
    });
    expect(player.state).toBe('idle');
  });

  it('warms the first riff and schedules hopTo at its tSec', async () => {
    const clock = { t: 100 };
    const sched = fakeScheduler(clock);
    const player = createHopPlayer({
      engine,
      resolveRiff,
      clock: () => clock.t,
      scheduler: sched,
    });
    const seq: HopSequence = {
      ...sequence(),
      hops: [{ tSec: 0.5, riffId: 'r1', jamId: JAM, transitionMs: 0 }],
      durationSec: 5,
    };
    await player.play(seq);
    // The first hop is 500ms after play() — should have scheduled with delayMs ~500.
    expect(sched.pending[0].delayMs).toBe(500);
    expect(engine.warmRiff).toHaveBeenCalled();
    expect(engine.hopTo).not.toHaveBeenCalled();

    await sched.advance(500);
    expect(engine.hopTo).toHaveBeenCalledTimes(1);
    expect(engine.hopTo).toHaveBeenCalledWith(JAM, riff('r1'), [stem('r1-s')], {
      crossfadeMs: 0,
    });
  });

  it('issues each hop at the right relative time', async () => {
    const clock = { t: 0 };
    const sched = fakeScheduler(clock);
    const player = createHopPlayer({
      engine,
      resolveRiff,
      clock: () => clock.t,
      scheduler: sched,
    });
    const seq = sequence(); // hops at tSec 0, 10, 20
    await player.play(seq);

    // First hop should fire ~immediately.
    await sched.advance(0);
    expect(engine.hopTo).toHaveBeenCalledTimes(1);
    expect(engine.hopTo.mock.calls[0][1].riffId).toBe('r1');

    // Advance to t=10s — second hop fires.
    await sched.advance(10000);
    expect(engine.hopTo).toHaveBeenCalledTimes(2);
    expect(engine.hopTo.mock.calls[1][1].riffId).toBe('r2');

    // Advance to t=20s — third hop fires.
    await sched.advance(10000);
    expect(engine.hopTo).toHaveBeenCalledTimes(3);
    expect(engine.hopTo.mock.calls[2][1].riffId).toBe('r3');
  });

  it('passes recorded transitionMs into engine.hopTo opts', async () => {
    const clock = { t: 0 };
    const sched = fakeScheduler(clock);
    const player = createHopPlayer({
      engine,
      resolveRiff,
      clock: () => clock.t,
      scheduler: sched,
    });
    await player.play(sequence());
    await sched.advance(0);
    await sched.advance(10000);
    // Second hop's recorded transitionMs is 250.
    expect(engine.hopTo).toHaveBeenLastCalledWith(
      JAM,
      riff('r2'),
      expect.any(Array),
      { crossfadeMs: 250 },
    );
  });

  it('stop() cancels all pending hops and calls engine.stop', async () => {
    const clock = { t: 0 };
    const sched = fakeScheduler(clock);
    const player = createHopPlayer({
      engine,
      resolveRiff,
      clock: () => clock.t,
      scheduler: sched,
    });
    await player.play(sequence());
    await sched.advance(0); // fire first hop

    player.stop();
    expect(engine.stop).toHaveBeenCalled();
    expect(sched.pending.filter((p) => !p.cancelled)).toHaveLength(0);

    // No further hops fire even as time advances.
    await sched.advance(20000);
    expect(engine.hopTo).toHaveBeenCalledTimes(1);
  });

  it('emits state changes through onStateChange', async () => {
    const clock = { t: 0 };
    const sched = fakeScheduler(clock);
    const player = createHopPlayer({
      engine,
      resolveRiff,
      clock: () => clock.t,
      scheduler: sched,
    });
    const states: string[] = [];
    player.onStateChange((s) => states.push(s));
    const seq: HopSequence = {
      ...sequence(),
      hops: [{ tSec: 0, riffId: 'r1', jamId: JAM, transitionMs: 0 }],
      durationSec: 1,
    };
    await player.play(seq);
    expect(states).toEqual(['playing']);
    await sched.advance(0); // fire the hop
    await sched.advance(1000); // fire the final stop
    expect(states).toEqual(['playing', 'idle']);
  });

  it('after the last hop, schedules a stop at durationSec', async () => {
    const clock = { t: 0 };
    const sched = fakeScheduler(clock);
    const player = createHopPlayer({
      engine,
      resolveRiff,
      clock: () => clock.t,
      scheduler: sched,
    });
    const seq: HopSequence = {
      ...sequence(),
      hops: [{ tSec: 0, riffId: 'r1', jamId: JAM, transitionMs: 0 }],
      durationSec: 5,
    };
    await player.play(seq);
    await sched.advance(0); // first hop
    // After firing the only hop, the player should have scheduled a
    // final stop at durationSec=5s.
    await sched.advance(5000);
    expect(engine.stop).toHaveBeenCalled();
    expect(player.state).toBe('idle');
  });

  it('pre-warms upcoming riffs ahead of their hop time', async () => {
    const clock = { t: 0 };
    const sched = fakeScheduler(clock);
    const player = createHopPlayer({
      engine,
      resolveRiff,
      clock: () => clock.t,
      scheduler: sched,
    });
    await player.play(sequence());
    // After play(), the next riff (r2) should have been warmed in
    // advance of its scheduled time (we don't wait until t=10 to
    // start fetching).
    await sched.advance(0); // fire first hop
    const warmedRiffIds = engine.warmRiff.mock.calls.map((c) => c[1].riffId);
    expect(warmedRiffIds).toContain('r2');
  });

  it('play() while already playing throws', async () => {
    const clock = { t: 0 };
    const sched = fakeScheduler(clock);
    const player = createHopPlayer({
      engine,
      resolveRiff,
      clock: () => clock.t,
      scheduler: sched,
    });
    await player.play(sequence());
    await expect(player.play(sequence())).rejects.toThrow(/already playing/i);
  });

  it('rejects empty hops with a clear error', async () => {
    const clock = { t: 0 };
    const sched = fakeScheduler(clock);
    const player = createHopPlayer({
      engine,
      resolveRiff,
      clock: () => clock.t,
      scheduler: sched,
    });
    const empty: HopSequence = { ...sequence(), hops: [], durationSec: 0 };
    await expect(player.play(empty)).rejects.toThrow(/no hops/i);
  });
});
