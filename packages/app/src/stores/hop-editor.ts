import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import type { JamCouchID, RiffCouchID, RiffDocument } from '@hoppper/sdk';
import type { HopSequence } from '../hop-recorder/types.js';
import type { SequenceStorage } from '../hop-recorder/storage.js';
import { computeRiffTiming } from '../audio/riff-timing.js';
import {
  deleteHop as deleteHopIn,
  duplicateSegment,
  insertRiff,
  moveHop as moveHopIn,
  type RiffGrid,
  type Snap,
} from '../hop-editor/edits.js';
import { createEditHistory, type EditHistory } from '../hop-editor/history.js';
import { log } from '../logging/log-store.js';

export interface HopEditorDeps {
  storage: Pick<SequenceStorage, 'loadSequence' | 'saveSequence'>;
  riffDocs: {
    get(id: RiffCouchID): RiffDocument | null | undefined;
    ensure(jamId: JamCouchID, ids: RiffCouchID[]): Promise<void>;
  };
  /** The jam's rifffs committed between two times (ms), ends included, in commit order. */
  riffIdsBetween(jamId: JamCouchID, aMs: number, bMs: number, limit: number): Promise<RiffCouchID[]>;
}

/** Most skipped rifffs Expand shows at once. */
const MAX_SKIPPED = 32;

/**
 * The take open in the hop editor. Edits change it in place and are saved as
 * they're made; undo and redo walk back through this session's edits (rules
 * signed off 2026-09-18, docs/phases/phase-8-redesign-and-editor.md).
 */
export function defineHopEditorStore(deps: HopEditorDeps) {
  return defineStore('hopEditor', () => {
    const take = shallowRef<HopSequence | null>(null);
    const lastOpened = ref<{ jamId: JamCouchID; id: string } | null>(null);
    const canUndo = ref(false);
    const canRedo = ref(false);
    const lastError = ref<string | null>(null);
    let history: EditHistory<HopSequence> | null = null;

    function syncHistory(): void {
      canUndo.value = history?.canUndo ?? false;
      canRedo.value = history?.canRedo ?? false;
    }

    async function open(jamId: JamCouchID, id: string): Promise<void> {
      lastError.value = null;
      const seq = await deps.storage.loadSequence(jamId, id);
      take.value = seq;
      history = createEditHistory(seq);
      lastOpened.value = { jamId, id };
      syncHistory();
      // Each rifff's tempo gives its beat and bar to snap to.
      try {
        await deps.riffDocs.ensure(jamId, [...new Set(seq.hops.map((h) => h.riffId))]);
      } catch (err) {
        log('warn', 'editor', `rifffs for the grid: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    function gridOf(riffId: RiffCouchID): RiffGrid | undefined {
      const doc = deps.riffDocs.get(riffId);
      if (!doc || !(doc.bps > 0)) return undefined;
      return { beatSec: 1 / doc.bps, barSec: computeRiffTiming(doc).secPerBar };
    }

    /** One loop of the rifff — how long Add and Duplicate put it in for. */
    function loopSecOf(riffId: RiffCouchID): number {
      const doc = deps.riffDocs.get(riffId);
      const loop = doc && doc.bps > 0 ? computeRiffTiming(doc).loopDurationSec : 0;
      return loop > 0 ? loop : 8;
    }

    async function save(seq: HopSequence): Promise<void> {
      try {
        await deps.storage.saveSequence(seq);
        lastError.value = null;
      } catch (err) {
        lastError.value = `Couldn’t save the hop: ${err instanceof Error ? err.message : String(err)}`;
        log('error', 'editor', lastError.value, err);
      }
    }

    async function apply(next: HopSequence): Promise<void> {
      if (!history || next === take.value) return;
      history.push(next);
      take.value = next;
      syncHistory();
      await save(next);
    }

    /**
     * What the hop at `point` skipped: the rifffs committed between the two
     * either side of it, in commit order — one ranged request, then their
     * documents. At most MAX_SKIPPED, from the earlier rifff on.
     */
    async function skippedAt(point: number): Promise<RiffDocument[]> {
      const seq = take.value;
      if (!seq || point < 1 || point >= seq.hops.length) return [];
      const from = deps.riffDocs.get(seq.hops[point - 1]!.riffId);
      const to = deps.riffDocs.get(seq.hops[point]!.riffId);
      if (!from || !to) return [];
      const ends = new Set([from.riffId, to.riffId]);
      const ids = (await deps.riffIdsBetween(seq.jamId, from.createdAt, to.createdAt, MAX_SKIPPED + 2))
        .filter((id) => !ends.has(id))
        .slice(0, MAX_SKIPPED);
      if (ids.length === 0) return [];
      await deps.riffDocs.ensure(seq.jamId, ids);
      return ids.map((id) => deps.riffDocs.get(id)).filter((r): r is RiffDocument => !!r);
    }

    const current = () => take.value;

    async function moveHop(index: number, toSec: number, snap: Snap): Promise<void> {
      const seq = current();
      if (seq) await apply(moveHopIn(seq, index, toSec, snap, gridOf));
    }
    async function deleteHop(index: number): Promise<void> {
      const seq = current();
      if (seq) await apply(deleteHopIn(seq, index, gridOf));
    }
    async function addRiff(index: number, riffId: RiffCouchID, lengthSec = loopSecOf(riffId)): Promise<void> {
      const seq = current();
      if (seq) await apply(insertRiff(seq, index, riffId, lengthSec, gridOf));
    }
    async function duplicate(index: number, lengthSec?: number): Promise<void> {
      const seq = current();
      const h = seq?.hops[index];
      if (seq && h) await apply(duplicateSegment(seq, index, lengthSec ?? loopSecOf(h.riffId), gridOf));
    }

    async function undo(): Promise<void> {
      if (!history?.canUndo) return;
      take.value = history.undo();
      syncHistory();
      await save(take.value);
    }
    async function redo(): Promise<void> {
      if (!history?.canRedo) return;
      take.value = history.redo();
      syncHistory();
      await save(take.value);
    }

    return {
      take,
      lastOpened,
      canUndo,
      canRedo,
      lastError,
      open,
      gridOf,
      loopSecOf,
      skippedAt,
      moveHop,
      deleteHop,
      addRiff,
      duplicate,
      undo,
      redo,
    };
  });
}
