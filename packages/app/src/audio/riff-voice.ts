import type { AudioBufferLike } from './audio-buffer-cache.js';

// Narrow facades over Web Audio so unit tests can run without a real
// AudioContext. The Web Audio types are structurally compatible.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AudioNodeLike {}

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, when: number): void;
  linearRampToValueAtTime(value: number, when: number): void;
  cancelScheduledValues(when: number): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
  connect(destination: AudioNodeLike): void;
  disconnect(): void;
}

export interface AudioBufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  // Loose signature so a real AudioBufferSourceNode satisfies us structurally.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onended: ((...args: any[]) => any) | null;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
  connect(destination: AudioNodeLike): void;
  disconnect(): void;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  createBufferSource(): AudioBufferSourceLike;
  createGain(): GainNodeLike;
}

export interface RiffVoiceOptions {
  context: AudioContextLike;
  /** 8-slot stem array; nulls are empty stem slots. */
  buffers: ReadonlyArray<AudioBufferLike | null>;
  loopDurationSec: number;
  /** Defaults to context.destination if omitted. */
  destination?: AudioNodeLike;
}

export interface RiffVoice {
  readonly stemCount: number;
  start(when: number, offset: number): void;
  stop(when: number): void;
  fadeIn(startTime: number, durationSec: number): void;
  fadeOut(startTime: number, durationSec: number): void;
  dispose(): void;
}

export function createRiffVoice(opts: RiffVoiceOptions): RiffVoice {
  const { context, buffers, loopDurationSec } = opts;
  const destination = opts.destination ?? context.destination;

  const gain = context.createGain();
  gain.connect(destination);

  const sources: AudioBufferSourceLike[] = [];
  for (const buffer of buffers) {
    if (buffer === null) continue;
    const src = context.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = loopDurationSec;
    src.connect(gain);
    sources.push(src);
  }

  let started = false;

  return {
    stemCount: sources.length,
    start(when, offset) {
      if (started) throw new Error('RiffVoice.start may only be called once');
      started = true;
      for (const src of sources) src.start(when, offset);
    },
    stop(when) {
      for (const src of sources) src.stop(when);
    },
    fadeIn(startTime, durationSec) {
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(1, startTime + durationSec);
    },
    fadeOut(startTime, durationSec) {
      gain.gain.setValueAtTime(gain.gain.value, startTime);
      gain.gain.linearRampToValueAtTime(0, startTime + durationSec);
    },
    dispose() {
      for (const src of sources) src.disconnect();
      gain.disconnect();
    },
  };
}
