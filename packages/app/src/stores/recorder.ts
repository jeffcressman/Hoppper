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
    const isRecording = ref(false);
    const isPlaying = ref(deps.player.state === 'playing');
    const saved = shallowRef<HopSequence[]>([]);
    const lastError = ref<string | null>(null);

    // The player flips back to 'idle' when its scheduled final-stop
    // fires, or when stop() is called externally. Without observing
    // this, isPlaying would stick at true and the next play() would
    // throw "already playing".
    deps.player.onStateChange((s) => {
      isPlaying.value = s === 'playing';
    });

    function start(jamId: JamCouchID, title?: string): void {
      if (isPlaying.value) {
        throw new Error('Cannot start recording while playing');
      }
      deps.recorder.start({ jamId, title });
      isRecording.value = true;
    }

    async function stop(): Promise<HopSequence | null> {
      if (!isRecording.value) return null;
      const seq = deps.recorder.stop();
      isRecording.value = false;
      try {
        await deps.storage.saveSequence(seq);
        await loadSaved(seq.jamId);
      } catch (err) {
        lastError.value = err instanceof Error ? err.message : String(err);
        throw err;
      }
      return seq;
    }

    async function loadSaved(jamId: JamCouchID): Promise<void> {
      saved.value = await deps.storage.listSequences(jamId);
    }

    async function play(seq: HopSequence): Promise<void> {
      if (isRecording.value) {
        throw new Error('Cannot play while recording');
      }
      await deps.player.play(seq);
      isPlaying.value = true;
    }

    function stopPlayback(): void {
      deps.player.stop();
      isPlaying.value = false;
    }

    async function del(jamId: JamCouchID, id: string): Promise<void> {
      await deps.storage.deleteSequence(jamId, id);
      await loadSaved(jamId);
    }

    return {
      isRecording,
      isPlaying,
      saved,
      lastError,
      start,
      stop,
      loadSaved,
      play,
      stopPlayback,
      delete: del,
    };
  });
}
