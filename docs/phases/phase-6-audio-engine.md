# Phase 6 — Audio engine: playback & phase-locked hops

Detailed design doc for Phase 6. `PLAN.md` carries the short checklist; this
file carries the audio-graph shape, decode pipeline, phase-lock math, cache
layering, TDD order, and deferred items.

## Background

Phases 2–4 produced the SDK: auth, jam/riff enumeration, stem URL
resolution, and a layered byte-cache for stem files. Phase 5 wired that
SDK into a Tauri shell with login, jam list, and jam detail (riff list)
views. **No audio has been played yet.**

Phase 6 turns the app from a browser into an instrument: a user can pick
a jam, click riffs in sequence, and hear phase-locked, gapless
transitions between them. This is the foundation for Phase 7 (record the
performance) and Phase 9 (render to disk).

The product concept is "riff hopping": the next riff begins at the same
position-within-the-loop where the previous riff was, so accents and bar
lines stay aligned even though the underlying audio changes. See
`README.md` for the user-facing pitch.

## Strategy

- **Web Audio + Tone.js.** Tone.js for `Transport`, `Player`, `Channel`,
  and the master bus — saves us a custom scheduler. Raw `AudioContext`
  for things Tone.js doesn't simplify (timing reads, `OfflineAudioContext`
  later). One `AudioContext` per app instance, created lazily on first
  user gesture (browser autoplay policy still applies inside Tauri's
  webview).
- **Decode in the renderer.** `decodeAudioData` for Ogg Vorbis; `libflac.js`
  (AudioWorklet-friendly) for FLAC. Both produce `AudioBuffer`s. No
  decode happens in Rust — keeps the audio engine portable to a web
  build later.
- **Two cache tiers, clearly separated.**
  - **Tier 1 (bytes)**: the SDK's `StemCache` from Phase 4. Lives on
    disk via Tauri. Persistent. Already done.
  - **Tier 2 (decoded `AudioBuffer`s)**: a new app-level LRU keyed by
    `StemCouchID`. Lives in memory only. Decoded buffers are 5–10×
    larger than the encoded bytes, so this tier evicts aggressively
    (default cap: ~256MB, configurable).
- **Phase-locked hop.** When the user picks a new riff while another is
  playing, we compute `elapsedInPrevLoop = (now - prevRiffStart) %
  prevLoopDurationSec`, start the new riff with `offset =
  elapsedInPrevLoop % newLoopDurationSec`, schedule a crossfade between
  two `GainNode`s over `crossfadeMs` (default 250ms, snap-to-bar
  optional). Both riffs' loops are independent — we do not retime.
- **Prefetch ring.** When viewing riff `N`, decode `N` plus `N±2` into
  the AudioBuffer cache in the background. Bytes-tier prefetch is
  already provided by `prefetchRiffs` from Phase 4; Phase 6 stacks a
  decode-prefetch on top.

## Architectural decisions

- **Audio code lives in the app, not the SDK.** The SDK stays Node- and
  browser-compatible; Web Audio is browser-only. App owns
  `packages/app/src/audio/`. SDK exposes `RiffDocument`, `StemDocument`,
  and `ResolvedStem` types — that's all the audio engine consumes from
  it.
- **Riff-aware, not stem-aware, at the public boundary.** The audio
  engine's public API takes whole riffs (`AudioEngine.queueRiff(riff,
  stems)`), not individual stems. Per-stem mute/solo is post-v1
  (Phase 8+). Phase 6 plays all eight slots at their stored gains.
- **Single `Tone.Transport` instance, not used for sync.** We don't put
  riffs on the Transport timeline because each riff has its own loop
  length. Instead each riff is a set of 8 `Tone.Player`s started with
  explicit `start(when, offset)` calls. Transport is reserved for the
  Phase 7 recorder's wall-clock alignment.
- **No retiming, no pitch-shifting.** If the next riff has a different
  BPM, its loop runs at its own tempo — phase-lock is positional, not
  tempo-locked. (Tempo-locking is a v2 idea; document it but don't
  build.)
- **Loop duration uses LORE's formula** (see
  `/refs/OUROVEON/src/r3.endlesss/endlesss/live.riff.cpp:88`):
  ```
  quarterBeats     = barLength / 4
  secPerBar        = (1 / bps) * quarterBeats
  barCount         = largest power of two in {1,2,4,8} such that
                       barCount * secPerBar < 60
  loopDurationSec  = barCount * secPerBar
  ```
  Pure function. Same input → same output. Lives in
  `audio/riff-timing.ts`.
- **Decoder picks format per stem, not per riff.** `ResolvedStem` already
  reports `format`. FLAC if present, Ogg otherwise — SDK already does
  this preference. The decoder just switches on `format`.
- **One Tauri command for byte loading; no `fetch('file://...')`.** The
  decoder asks the byte cache for a `Uint8Array` directly. The byte
  cache lives in JS land already (Phase 5 `TauriFsAdapter`), so no new
  Rust command is needed.
- **Crossfade graph is two stem-channel groups, not per-stem
  crossfades.** Each riff renders into a `Tone.Channel` (its own
  `GainNode`). The active riff's channel fades from 1→0 over
  `crossfadeMs`; the incoming riff's channel fades from 0→1 in the same
  window. Both connect to the master bus. After the crossfade
  completes, the outgoing players are stopped and disposed.
- **AudioBuffer cache has a synchronous `get` and an async `getOrDecode`.**
  Phase-locked hop scheduling needs a synchronous read — if the buffer
  isn't decoded yet, we don't try to hop (return a typed "not ready"
  result and let the UI show a busy state). Pre-warming via
  `getOrDecode` is what the prefetch ring uses.

## Module layout

```
packages/app/src/audio/
├── audio-context.ts        # singleton AudioContext + first-gesture unlock
├── riff-timing.ts          # pure: bps + barLength → loopDurationSec, etc.
├── decoder.ts              # bytes + format → AudioBuffer (FLAC | Ogg)
├── audio-buffer-cache.ts   # LRU<StemCouchID, AudioBuffer> with size cap
├── stem-loader.ts          # composes: StemCache (bytes) → Decoder → AudioBufferCache
├── riff-voice.ts           # one playing riff: 8 Players + Channel + state machine
├── engine.ts               # AudioEngine: queueRiff, hop, stop, status
├── prefetch.ts             # decode-prefetch ring around current riff
└── index.ts
```

UI layer (Phase 6 also lands the perform view):

```
packages/app/src/views/
└── PerformView.vue         # riff list + hop button + playhead indicator

packages/app/src/stores/
└── performance.ts          # Pinia: current riff, queued riff, playhead, error state
```

Route: `/jams/:jamId/perform` (existing `JamDetailView` gets a "Perform"
button).

## Key interfaces

```ts
// audio/riff-timing.ts
export interface RiffTiming {
  bps: number;
  bpm: number;
  quarterBeats: number;
  secPerBar: number;
  barCount: number;      // 1 | 2 | 4 | 8
  loopDurationSec: number;
}
export function computeRiffTiming(riff: RiffDocument): RiffTiming;

// audio/decoder.ts
export interface Decoder {
  decode(bytes: Uint8Array, format: StemFormat): Promise<AudioBuffer>;
}

// audio/audio-buffer-cache.ts
export interface AudioBufferCache {
  get(stemId: StemCouchID): AudioBuffer | undefined; // sync
  put(stemId: StemCouchID, buffer: AudioBuffer): void;
  has(stemId: StemCouchID): boolean;
  approxBytes(): number;
}

// audio/engine.ts
export interface AudioEngine {
  /** Decode + hold buffers in memory; safe to call repeatedly. */
  warmRiff(riff: RiffDocument, stems: ResolvedStem[]): Promise<void>;

  /**
   * Start playing `riff`. If something is already playing, phase-lock
   * and crossfade. Returns when the new riff is scheduled (not when the
   * crossfade completes).
   */
  hopTo(riff: RiffDocument, stems: ResolvedStem[]): Promise<HopResult>;

  /** Stop everything; release voices. */
  stop(): void;

  /** AudioContext.currentTime — exposed so the recorder can timestamp. */
  now(): number;

  /** Observable status snapshot. */
  readonly state: AudioEngineState; // 'idle' | 'playing' | 'crossfading' | 'error'
  readonly currentRiffId: RiffCouchID | null;
  onStateChange(fn: (s: AudioEngineState) => void): () => void;
}

export type HopResult =
  | { kind: 'started';    riffId: RiffCouchID; whenSec: number }
  | { kind: 'phase-locked'; riffId: RiffCouchID; whenSec: number; offsetSec: number }
  | { kind: 'not-ready';  missingStemIds: StemCouchID[] };
```

## Phase-lock math (canonical form)

```
prevStart        = (engine-recorded) start time of currently playing riff
prevLoopDur      = computeRiffTiming(prevRiff).loopDurationSec
newLoopDur       = computeRiffTiming(newRiff).loopDurationSec
now              = audioContext.currentTime
crossfadeSec     = crossfadeMs / 1000

elapsedInPrev    = ((now + crossfadeSec) - prevStart) mod prevLoopDur
offsetInNew      = elapsedInPrev mod newLoopDur
startWhen        = now + crossfadeSec  // schedule new riff to begin
                                       // when crossfade midpoint hits
```

Two subtleties:

1. We schedule the new riff slightly in the future (`now +
   crossfadeSec`) so the offset accounts for the time the crossfade
   takes. This means a hop "lands" at the end of the crossfade window.
2. If the user enables snap-to-bar, round `startWhen` up to the next
   `prevStart + k * prevSecPerBar` and recompute `offsetInNew` from that
   `startWhen`. Keep snap-to-bar off by default — feels laggy on slow
   loops.

## Pre-cache strategy

Two prefetch loops, both anchored to "currently viewed riff":

- **Bytes** (already exists in SDK Phase 4): `prefetchRiffs(jamId,
  centerIdx ± 2)` — keeps stem bytes resident on disk.
- **Decoded buffers** (new in Phase 6): for each of the 5 riffs in the
  window, ensure every stem's `AudioBuffer` is in
  `AudioBufferCache`. Decode in series (FLAC decode is heavy), cancel
  if the window moves before this riff is reached.

The window updates whenever the user navigates the riff list. We
**don't** prefetch on play — by the time you hop, it's too late.

## TDD order

Pure-first, then I/O, then UI. Each entry is a small commit.

1. **`riff-timing.ts`** — pure math, 100% testable. Property tests
   against LORE's worked examples (steal a few `(bps, barLength) →
   loopDur` cases from `live.riff.cpp` log lines).
2. **`audio-buffer-cache.ts`** — LRU semantics, byte accounting, eviction
   order. No Web Audio involvement; pass in fake `AudioBuffer`s
   (objects with `duration`, `length`, `numberOfChannels`,
   `sampleRate`).
3. **`decoder.ts`** — interface + format dispatch. Test the dispatch
   logic with stub decoders; the real FLAC/Ogg implementations are
   thin and integration-tested via happy-dom or a single live test
   with `HOPPPER_RUN_LIVE_AUDIO_TESTS=1`.
4. **`stem-loader.ts`** — composes byte cache + decoder + buffer cache.
   Test cache-miss → decode → put, cache-hit → no decode, parallel
   loads coalesce (no double decode of the same stem).
5. **Phase-lock math (in `engine.ts`)** — extract `computeHop({ now,
   prevStart, prevLoopDur, newLoopDur, crossfadeSec, snap })` as a pure
   function and test it independently of any audio playback.
6. **`riff-voice.ts`** — uses a stub `AudioContextLike` interface that
   `AudioContext` satisfies. Tests assert the right number of
   `AudioBufferSourceNode`s are created, started with the right
   `(when, offset)`, and disposed on stop. No real audio plays in the
   unit test.
7. **`engine.ts`** integration — wire real Tone.js with a `mock
   AudioContext` (Tone supports passing one). Assert: queueRiff →
   playing; second queueRiff → phase-lock + crossfade; stop → idle.
8. **`prefetch.ts`** — window math, cancellation. Stub the loader.
9. **`PerformView.vue`** — view-level test with `@vue/test-utils`:
   clicking a riff fires `engine.hopTo`; "not-ready" state shows a
   busy badge.
10. **Manual smoke**: `pnpm dev`, log in, pick a small jam, click
    through riffs, listen. (Tests can't verify "it sounds right.")

## Deferred to later phases

- Per-stem mute/solo, gain trim → Phase 8.
- Waveform display → Phase 8 (likely `wavesurfer.js`).
- Tempo-locking across riffs (timestretch) → post-v1; would need
  AudioWorklet timestretch.
- Latency compensation for the crossfade scheduling vs. perceived
  click moment → revisit in Phase 7 when recording timestamps matter.
- Export render path (`OfflineAudioContext`) → Phase 9.
- MIDI clock out → post-v1.

## Open questions

- **libflac.js footprint vs. Rust-side decode.** Bundle size of
  libflac.js is ~600KB. If that proves painful, we move FLAC decode to
  a Rust Tauri command (`symphonia` crate) and pass back raw samples.
  Decide after Phase 6 ships once we have real load numbers. The
  `Decoder` interface is designed so this swap is contained.
- **AudioBuffer cap default.** 256MB is a guess. Profile typical jam
  sessions in Phase 6 and adjust before Phase 7.
- **Crossfade curve.** Linear for v0. Equal-power (`cos`/`sin`) sounds
  better but only matters at longer fades; revisit if the default 250ms
  linear xfade is audibly bad.

## Checkpoint

A user can:

1. Open a jam in the perform view.
2. Click any riff → it starts playing, looping at the bar.
3. Click another riff → seamless phase-locked crossfade, audibly aligned.
4. Click stop → silence within `crossfadeMs`.
5. Navigate the riff list → next/prev riffs are pre-decoded in the
   background (verify via dev panel or log).

Pause for user review before starting Phase 7.
