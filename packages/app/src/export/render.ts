import type { JamCouchID, ResolvedStem, RiffCouchID, RiffDocument } from '@hoppper/sdk';
import type { AudioEngine } from '../audio/engine';
import type { AudioContextLike } from '../audio/riff-voice';
import type { HopSequence } from '../hop-recorder/types';

export interface RenderedBufferLike {
  numberOfChannels: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface OfflineContextLike extends AudioContextLike {
  startRendering(): Promise<RenderedBufferLike>;
}

export interface RenderDeps {
  sampleRate: number;
  /** A stereo OfflineAudioContext `frames` long. */
  createContext(frames: number, sampleRate: number): OfflineContextLike;
  /** An engine playing into that context, sharing the app's decoded stems. */
  createEngine(context: OfflineContextLike): Pick<AudioEngine, 'warmRiff' | 'hopTo'>;
  resolveRiff(jamId: JamCouchID, riffId: RiffCouchID): Promise<{ riff: RiffDocument; stems: ResolvedStem[] }>;
}

export interface RenderedTake {
  channels: Float32Array[];
  sampleRate: number;
}

/**
 * Render a take offline through the same engine that plays it live, so the
 * file is what replay sounds like: every hop at its time, with its crossfade
 * and quantise, phase-locked to one grid, each rifff at its own mix.
 */
export async function renderTake(seq: HopSequence, deps: RenderDeps): Promise<RenderedTake> {
  const frames = Math.max(1, Math.ceil(seq.durationSec * deps.sampleRate));
  const context = deps.createContext(frames, deps.sampleRate);
  const engine = deps.createEngine(context);

  // Everything decoded before anything is scheduled.
  const resolved = new Map<RiffCouchID, { riff: RiffDocument; stems: ResolvedStem[] }>();
  for (const h of seq.hops) {
    if (resolved.has(h.riffId)) continue;
    const entry = await deps.resolveRiff(seq.jamId, h.riffId);
    resolved.set(h.riffId, entry);
    await engine.warmRiff(seq.jamId, entry.riff, entry.stems);
  }

  for (const h of seq.hops) {
    const { riff, stems } = resolved.get(h.riffId)!;
    const result = await engine.hopTo(h.jamId, riff, stems, {
      crossfadeMs: h.transitionMs,
      ...(h.quantise === undefined ? {} : { quantise: h.quantise }),
      atSec: h.tSec,
    });
    if (result.kind === 'not-ready') {
      throw new Error(`Couldn’t load rifff ${h.riffId} for the export`);
    }
  }

  const buffer = await context.startRendering();
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  return { channels, sampleRate: buffer.sampleRate };
}
