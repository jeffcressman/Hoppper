import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { JamCouchID, RiffCouchID, RiffDocument } from '@hoppper/sdk';
import type { HopEvent, HopSequence } from '../../src/hop-recorder/types';
import type { SequenceStorage } from '../../src/hop-recorder/storage';
import { defineHopEditorStore } from '../../src/stores/hop-editor';

const JAM = 'band1' as JamCouchID;
const hop = (tSec: number, riffId: string): HopEvent => ({ tSec, riffId: riffId as RiffCouchID, jamId: JAM, transitionMs: 250 });
const take = (): HopSequence => ({
  schemaVersion: 1,
  id: 't1',
  title: 'Take',
  jamId: JAM,
  recordedAt: '',
  durationSec: 24,
  hops: [hop(0, 'A'), hop(7.75, 'B'), hop(15.75, 'C')],
});

// 120 BPM, 4/4, 8-bar loops: half-second beats, 2 s bars, 16 s loops.
// Committed a minute apart, A first.
const created: Record<string, number> = { A: 60_000, B: 300_000, C: 360_000 };
const riff = (riffId: string) =>
  ({ riffId, jamId: JAM, bps: 2, barLength: 16, createdAt: created[riffId] ?? 0 }) as RiffDocument;

function setup() {
  const saved: HopSequence[] = [];
  const storage = {
    loadSequence: vi.fn(async () => take()),
    saveSequence: vi.fn(async (s: HopSequence) => {
      saved.push(s);
    }),
  } as unknown as SequenceStorage & { saveSequence: ReturnType<typeof vi.fn> };
  const riffDocs = {
    get: (id: RiffCouchID) => riff(id),
    ensure: vi.fn(async () => {}),
  };
  // Everything committed from A to B, ends included, in commit order.
  const riffIdsBetween = vi.fn(async () => ['A', 'X', 'Y', 'B'] as RiffCouchID[]);
  const store = defineHopEditorStore({ storage, riffDocs, riffIdsBetween })();
  return { store, storage, riffDocs, saved, riffIdsBetween };
}

const riffIds = (s: HopSequence | null) => s?.hops.map((h) => h.riffId);

beforeEach(() => setActivePinia(createPinia()));

describe('hop editor store', () => {
  it('opens a take from disk, and fetches its rifffs for their tempo', async () => {
    const { store, riffDocs } = setup();
    await store.open(JAM, 't1');
    expect(riffIds(store.take)).toEqual(['A', 'B', 'C']);
    expect(riffDocs.ensure).toHaveBeenCalledWith(JAM, ['A', 'B', 'C']);
    expect(store.lastOpened).toEqual({ jamId: JAM, id: 't1' });
  });

  it('reads each rifff’s beat and bar from its rifff document', async () => {
    const { store } = setup();
    expect(store.gridOf('A' as RiffCouchID)).toEqual({ beatSec: 0.5, barSec: 2 });
    expect(store.loopSecOf('A' as RiffCouchID)).toBe(16);
  });

  it('saves every edit as it is made', async () => {
    const { store, saved } = setup();
    await store.open(JAM, 't1');
    await store.moveHop(1, 6.9, 'beat');
    expect(saved.at(-1)?.hops[1]?.tSec).toBe(6.75);
    await store.deleteHop(1);
    expect(riffIds(saved.at(-1)!)).toEqual(['A', 'C']);
  });

  it('adds a skipped rifff, or duplicates one, for one loop of it', async () => {
    const { store } = setup();
    await store.open(JAM, 't1');
    await store.addRiff(1, 'X' as RiffCouchID);
    expect(riffIds(store.take)).toEqual(['A', 'X', 'B', 'C']);
    expect(store.take!.durationSec).toBe(40);
    await store.duplicate(0);
    expect(riffIds(store.take)).toEqual(['A', 'A', 'X', 'B', 'C']);
  });

  it('undo and redo walk through the edits, and save as they go', async () => {
    const { store, saved } = setup();
    await store.open(JAM, 't1');
    await store.deleteHop(1);
    expect(store.canUndo).toBe(true);
    await store.undo();
    expect(riffIds(store.take)).toEqual(['A', 'B', 'C']);
    expect(riffIds(saved.at(-1)!)).toEqual(['A', 'B', 'C']);
    expect(store.canRedo).toBe(true);
    await store.redo();
    expect(riffIds(store.take)).toEqual(['A', 'C']);
  });

  it('an edit that changes nothing isn’t an undo step', async () => {
    const { store, storage } = setup();
    await store.open(JAM, 't1');
    await store.deleteHop(0);
    expect(store.canUndo).toBe(false);
    expect(storage.saveSequence).not.toHaveBeenCalled();
  });

  it('keeps the edit and says so when it can’t be saved', async () => {
    const { store, storage } = setup();
    await store.open(JAM, 't1');
    storage.saveSequence.mockRejectedValueOnce(new Error('disk full'));
    await store.deleteHop(1);
    expect(riffIds(store.take)).toEqual(['A', 'C']);
    expect(store.lastError).toContain('disk full');
  });

  it('opening another take starts a fresh undo history', async () => {
    const { store } = setup();
    await store.open(JAM, 't1');
    await store.deleteHop(1);
    await store.open(JAM, 't1');
    expect(store.canUndo).toBe(false);
  });

  it('Expand finds the rifffs a hop skipped: committed between the two, in order, with their documents', async () => {
    const { store, riffDocs, riffIdsBetween } = setup();
    await store.open(JAM, 't1');
    const skipped = await store.skippedAt(1);
    expect(riffIdsBetween).toHaveBeenCalledWith(JAM, 60_000, 300_000, expect.any(Number));
    expect(skipped.map((r) => r.riffId)).toEqual(['X', 'Y']);
    expect(riffDocs.ensure).toHaveBeenLastCalledWith(JAM, ['X', 'Y']);
  });

  it('Expand at the first rifff, or out of range, finds nothing and asks for nothing', async () => {
    const { store, riffIdsBetween } = setup();
    await store.open(JAM, 't1');
    expect(await store.skippedAt(0)).toEqual([]);
    expect(await store.skippedAt(5)).toEqual([]);
    expect(riffIdsBetween).not.toHaveBeenCalled();
  });

  it('the start and end handles resize the take, saved and undoable like any edit', async () => {
    const { store, saved } = setup();
    await store.open(JAM, 't1');
    await store.resizeStart(4, 'beat');
    expect(store.take!.durationSec).toBe(28);
    await store.resizeEnd(40, 'bar');
    expect(saved.at(-1)?.durationSec).toBe(40);
    await store.undo();
    await store.undo();
    expect(store.take!.durationSec).toBe(24);
  });

  describe('automation points', () => {
    it('adds a point to a track’s line, saved and undoable — starting from flat lines on an older take', async () => {
      const { store, saved } = setup();
      await store.open(JAM, 't1');
      await store.addAutomationPoint(2, 'volume', 4, 0.5);
      expect(store.take!.automation).toHaveLength(8);
      expect(store.take!.automation![2]!.volume).toEqual([{ tSec: 4, value: 0.5 }]);
      expect(saved.at(-1)?.automation?.[2]?.volume).toEqual([{ tSec: 4, value: 0.5 }]);
      await store.undo();
      expect(store.take!.automation).toBeUndefined();
    });

    it('moves and removes points', async () => {
      const { store } = setup();
      await store.open(JAM, 't1');
      await store.addAutomationPoint(0, 'mute', 2, 1);
      await store.addAutomationPoint(0, 'mute', 6, 0);
      await store.moveAutomationPoint(0, 'mute', 0, 3, 1);
      expect(store.take!.automation![0]!.mute).toEqual([{ tSec: 3, value: 1 }, { tSec: 6, value: 0 }]);
      await store.removeAutomationPoint(0, 'mute', 1);
      expect(store.take!.automation![0]!.mute).toEqual([{ tSec: 3, value: 1 }]);
    });
  });
});
