import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import type { JamCouchID } from '@hoppper/sdk';
import type { HopRecorder } from '../hop-recorder/recorder.js';
import type { SequenceStorage } from '../hop-recorder/storage.js';
import type { HopPlayer } from '../hop-recorder/player.js';
import type { HopSequence } from '../hop-recorder/types.js';
import { log } from '../logging/log-store.js';

export interface RecorderDeps {
  recorder: HopRecorder;
  storage: SequenceStorage;
  player: HopPlayer;
  /**
   * A finished take's name — "20260919 <jam> hoppp", from its first rifff
   * (`hop-recorder/naming.ts`). Without it, or if it fails, the take keeps
   * the recorder's default.
   */
  nameTake?: (seq: HopSequence) => Promise<string>;
  /**
   * Names for many takes at once, by take id — batched per jam, for renaming
   * takes made before the naming format. A take missing from the result keeps
   * its name.
   */
  nameTakes?: (seqs: HopSequence[]) => Promise<Map<string, string>>;
}

/** A take still wearing the recorder's old default name: its own timestamp. */
const hasDefaultName = (seq: HopSequence) => seq.title === seq.recordedAt;

export function defineRecorderStore(deps: RecorderDeps) {
  return defineStore('recorder', () => {
    // Both follow the HopRecorder: the performance store records hops into it
    // directly, so the first hop — which ends `armed` — never passes through
    // this store.
    const isRecording = ref(deps.recorder.isRecording);
    const isArmed = ref(deps.recorder.state === 'armed');
    const isPlaying = ref(deps.player.state === 'playing');
    /** The saved sequence being replayed, for the view to mark. */
    const playingId = ref<string | null>(null);
    const saved = shallowRef<HopSequence[]>([]);
    /** Every jam's takes, newest first — what the Hops page lists. */
    const allSaved = shallowRef<HopSequence[]>([]);
    const lastError = ref<string | null>(null);

    // The player flips back to 'idle' when its scheduled final-stop
    // fires, or when stop() is called externally. Without observing
    // this, isPlaying would stick at true and the next play() would
    // throw "already playing".
    deps.player.onStateChange((s) => {
      isPlaying.value = s === 'playing';
      if (s !== 'playing') playingId.value = null;
    });
    deps.recorder.onStateChange((s) => {
      isRecording.value = s !== 'idle';
      isArmed.value = s === 'armed';
    });

    function start(jamId: JamCouchID, title?: string): void {
      if (isPlaying.value) {
        throw new Error('Cannot start recording while playing');
      }
      deps.recorder.start({ jamId, title });
    }

    async function stop(): Promise<HopSequence | null> {
      if (!isRecording.value) return null;
      let seq = deps.recorder.stop();
      // Stopped before any rifff was clicked: nothing to replay, so no take.
      if (seq.hops.length === 0) return null;
      if (deps.nameTake) {
        try {
          seq = { ...seq, title: await deps.nameTake(seq) };
        } catch (err) {
          log('warn', 'recorder', `naming the take: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      try {
        await deps.storage.saveSequence(seq);
        await Promise.all([loadSaved(seq.jamId), loadAll()]);
      } catch (err) {
        lastError.value = err instanceof Error ? err.message : String(err);
        throw err;
      }
      return seq;
    }

    async function loadSaved(jamId: JamCouchID): Promise<void> {
      saved.value = await deps.storage.listSequences(jamId);
    }

    async function loadAll(): Promise<void> {
      allSaved.value = await deps.storage.listAllSequences();
    }

    async function play(seq: HopSequence): Promise<void> {
      if (isRecording.value) {
        throw new Error('Cannot play while recording');
      }
      const previousId = playingId.value;
      playingId.value = seq.id;
      try {
        await deps.player.play(seq);
      } catch (err) {
        playingId.value = previousId;
        throw err;
      }
      // Ask the player rather than assume: Stop may have landed while the
      // replay was still loading its first rifffs.
      isPlaying.value = deps.player.state === 'playing';
    }

    /** Seconds into the take being replayed, or null — read every frame by the editor. */
    const playPosition = () => deps.player.positionSec();

    /**
     * Give takes made before the naming format their "YYYYMMDD <jam> hoppp"
     * name. Only takes still on the old default; failing (offline, say)
     * leaves them to try again next time.
     */
    async function renameOldTakes(): Promise<void> {
      const old = allSaved.value.filter(hasDefaultName);
      if (old.length === 0 || !deps.nameTakes) return;
      let names: Map<string, string>;
      try {
        names = await deps.nameTakes(old);
      } catch (err) {
        log('warn', 'recorder', `renaming old takes: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      let renamed = 0;
      for (const seq of old) {
        const title = names.get(seq.id);
        if (!title) continue;
        try {
          await deps.storage.saveSequence({ ...seq, title });
          renamed += 1;
        } catch (err) {
          log('warn', 'recorder', `renaming ${seq.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (renamed > 0) await loadAll();
    }

    function stopPlayback(): void {
      deps.player.stop();
      isPlaying.value = false;
      playingId.value = null;
    }

    async function del(jamId: JamCouchID, id: string): Promise<void> {
      await deps.storage.deleteSequence(jamId, id);
      await Promise.all([loadSaved(jamId), loadAll()]);
    }

    return {
      isRecording,
      isArmed,
      isPlaying,
      playingId,
      saved,
      allSaved,
      lastError,
      start,
      stop,
      loadSaved,
      loadAll,
      renameOldTakes,
      play,
      playPosition,
      stopPlayback,
      delete: del,
    };
  });
}
