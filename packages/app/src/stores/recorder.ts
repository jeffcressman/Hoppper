import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import type { JamCouchID } from '@hoppper/sdk';
import type { HopRecorder } from '../hop-recorder/recorder.js';
import type { SequenceStorage } from '../hop-recorder/storage.js';
import type { HopPlayer } from '../hop-recorder/player.js';
import type { HopSequence } from '../hop-recorder/types.js';

export interface RecorderDeps {
  recorder: HopRecorder;
  storage: SequenceStorage;
  player: HopPlayer;
}

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
      const seq = deps.recorder.stop();
      // Stopped before any rifff was clicked: nothing to replay, so no take.
      if (seq.hops.length === 0) return null;
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
      play,
      playPosition,
      stopPlayback,
      delete: del,
    };
  });
}
