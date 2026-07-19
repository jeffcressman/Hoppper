# Phase 7 — Hop recording

Detailed design doc for Phase 7. `PLAN.md` carries the short checklist;
this file carries the data model, recorder/player wiring, persistence
layout, TDD order, and deferred items.

## Background

Phase 6 made the app an instrument: the user can pick a jam and hop
between riffs with phase-locked, gapless transitions. Phase 7 turns
those clicks into a saved artifact — a `HopSequence` that captures
*what was played and when*, so it can be reopened and replayed
identically. This is the foundation Phase 8 will edit and Phase 9 will
render to disk.

The recording captures the **timing of user decisions**, not audio
samples. Audio is already addressable: each stem lives in the layered
cache by `StemCouchID`, and each riff resolves deterministically from
its `RiffDocument`. A `HopSequence` is therefore a sparse, structural
description — a few hundred bytes of JSON for a multi-minute
performance — and replay reconstructs the audio from the same stems
that produced it live.

## Strategy

- **Capture at the click, not at the engine.** The user is *playing*
  the riff feed; their timing is the performance. When they click a
  riff that's still buffering, the engine returns `not-ready` and no
  audio transition happens — but the click still matters and gets
  recorded. The recorder is wired into the click handler (via the
  performance store), not into the engine. On replay we pre-warm the
  upcoming window so buffering is unlikely to bite a second time.
- **Times in seconds, relative to recording start.** Recorder snapshots
  `now()` at `start()`; every event stores `tSec = now() - t0`.
  `AudioContext.currentTime` is the clock at runtime; tests inject a
  controllable function. The first event's `tSec` is whatever time the
  click happens — `0` if the user clicked Record and a riff in the
  same tick, otherwise the gap between the two.
- **Hop-level transition durations.** `transitionMs` is recorded per
  event, not on the sequence — different hops can use different
  crossfade lengths and replay must honor each.
- **Explicit `durationSec`.** A sequence with one hop and a 30-second
  tail is meaningfully different from a sequence with one hop and no
  tail. We capture the tail by storing the time of `stop()` as
  `durationSec`, separate from the last hop's `tSec`.
- **Riff-level granularity.** Per-stem mute/solo events are post-v1
  (Phase 8+). v1 records `(riffId, jamId, transitionMs)` per hop.
- **Persist as JSON, on disk, one file per sequence.** Lives at
  `<appLocalDataDir>/sequences/<sequenceId>.json`. Atomic write via the
  same Tauri FS pattern used by `FilesystemStemCache`. No sqlite, no
  index file — directory listing is the index. Sequences are small;
  even thousands of files is fine for a directory.
- **Read-only replay for v1.** A `HopPlayer` reads a sequence and
  drives the existing `AudioEngine` via `setTimeout`-scheduled
  `hopTo` calls. Edits land in Phase 8.

## Architectural decisions

- **Recorder lives in the app, not the SDK.** Same reasoning as the
  audio engine: Web-Audio-shaped clock, Tauri-shaped filesystem. The
  SDK exposes `RiffCouchID`/`JamCouchID` types — that's the
  surface the recorder touches.
- **`HopRecorder` is pure.** It accepts a clock function and exposes
  `start/recordHop/stop/getSequence`. No engine reference, no FS
  reference. It's the performance store that calls `recordHop()` at
  the same point it calls `engine.hopTo()`.
- **Every click is recorded, including not-ready ones.** Replay
  re-issues the same `hopTo` at the same relative time; the player
  pre-warms a window around each upcoming event so buffering is much
  less likely on replay than it was during the live take. If a riff
  truly can't be loaded at replay time, the player surfaces an error
  but the sequence as recorded stays intact.
- **One `HopSequence` per file.** No bundle format. Sequences reference
  stems by `StemCouchID`/`RiffCouchID` which are content-addressable;
  the stems live in the layered cache. Phase 9's export step will
  bundle a sequence + its referenced stems into a `.zip` for
  portability, but the on-disk *project* form is JSON-only.
- **Schema versioning from day one.** `schemaVersion: 1` on every file.
  Loader rejects unknown versions with a clear error. Cheap insurance.
- **Sequence IDs are content-free.** Generate a short slug at
  `start()` (e.g. `crypto.randomUUID()` truncated). Title is mutable;
  ID is not.

## Data model

```ts
// One user-initiated hop, recorded.
interface HopEvent {
  // Seconds from the start of the recording. First event's tSec is
  // whatever time the click happens — 0 if Record + click are in the
  // same tick, otherwise the gap between them.
  tSec: number;
  // The riff that became active at this moment.
  riffId: RiffCouchID;
  // The jam this riff belongs to. v1 sequences are single-jam, but we
  // store this per-event so cross-jam recordings are trivial later.
  jamId: JamCouchID;
  // Crossfade duration used at this hop, in ms. 0 for the cold-start
  // event (no previous riff to fade out).
  transitionMs: number;
}

interface HopSequence {
  schemaVersion: 1;
  // Stable, content-free identifier. Used as the filename stem.
  id: string;
  // Human-readable label. Defaults to recordedAt ISO date.
  title: string;
  // The jam this sequence was recorded against. v1: all hops share
  // this jamId. Kept top-level for fast list-view rendering without
  // parsing every hop.
  jamId: JamCouchID;
  // Wall-clock recording start, ISO 8601.
  recordedAt: string;
  // Total duration in seconds, from t=0 through the stop() call.
  // Captures any tail after the last hop.
  durationSec: number;
  hops: HopEvent[];
}
```

## Module layout

```
packages/app/src/hop-recorder/
├── types.ts          # HopEvent, HopSequence, parse/stringify
├── recorder.ts       # createHopRecorder(): pure
├── storage.ts        # save/list/load/delete via FsAdapter
├── player.ts         # createHopPlayer(): drives AudioEngine
└── index.ts
```

Engine changes: **none.** Recording attaches at the click layer.

App changes:
- `usePerformanceStore.hopTo` is the call site: it calls
  `recorder.recordHop(...)` (if recording) at the same moment it
  invokes `engine.hopTo(...)`. The recorder doesn't see the engine's
  result — the click itself is the event.
- New `useRecorderStore` — exposes `isRecording`, `start`, `stop`,
  `saved` (list, scoped to current jam), `play(id)`, `delete(id)`.
- `PerformView` gains a `[● Record]` button in the header and a
  collapsible saved-sequences drawer with `[▶ Play]` / `[🗑 Delete]`
  per row, filtered to the current jam.

## TDD order

1. **`HopSequence` types + JSON round-trip.** `parseSequence` rejects
   unknown `schemaVersion` and malformed shapes. `serializeSequence`
   produces canonical key order.
2. **`HopRecorder` (pure).** Clock injection; `start` snapshots t0;
   `recordHop` appends events with `tSec` relative to t0; `stop` sets
   `durationSec`. Calling `recordHop` outside `start/stop` is a no-op
   (the store may call it whether or not recording is active).
3. **Wire recorder into `usePerformanceStore`.** Test: when
   `isRecording`, `hopTo` calls `recorder.recordHop`. When not, it
   doesn't. The engine result (success or `not-ready`) does **not**
   gate recording.
4. **Storage round-trip with mock `FsAdapter`.** `saveSequence`,
   `listSequences(jamId)`, `loadSequence`, `deleteSequence`. Atomic
   write pattern (write to `.tmp`, rename). Rejects malformed JSON
   and unknown `schemaVersion` with a clear error.
5. **`HopPlayer`.** Drives a mock engine through a fixture sequence
   via a controllable clock + scheduler. Asserts the engine sees
   `hopTo` calls at the right relative times with the right
   `transitionMs`. `stop()` cancels pending hops. Pre-warms a small
   window of upcoming riffs before each hop.
6. **`useRecorderStore`** — Pinia store wrapping recorder/storage/
   player. Tests assert state transitions and that `play(id)` reloads
   stems via the same `StemResolver` the perform store uses.
7. **`PerformView` UI** — Record button toggles state; saved
   sequences drawer renders + acts. Visual smoke gated on a real
   listen-through, same as Phase 6's checkpoint.

## Deferred (Phase 8+)

- Editing operations (drag hop, change `tSec`/`transitionMs`, delete,
  insert from riff browser).
- Multi-jam sequences (data model already supports; UI doesn't).
- Stem-level mute/solo per hop.
- Waveform display in the timeline.
- Render to disk (Phase 9).
- Project bundle export (`.zip` with referenced stems for
  portability).
- Sequence rename (mutate `title`) — easy add but not v1.

## Open questions

- **Should `HopPlayer` use `AudioContext`'s clock or wall-clock?**
  Wall-clock (`setTimeout`) drifts; `AudioContext.currentTime` is
  monotonic and sample-accurate. Recorder uses `AudioContext` so the
  player should too. v1 implementation: schedule the next hop via
  `setTimeout` keyed off `audioContext.currentTime` deltas, recomputed
  each tick to absorb drift. Sample-accurate scheduling can come later
  if needed.
- **What happens when a sequence references a riff the user no longer
  has access to?** v1: `HopPlayer.play()` rejects with a clear error
  identifying the missing riff. Phase 8 can surface this in the UI.
