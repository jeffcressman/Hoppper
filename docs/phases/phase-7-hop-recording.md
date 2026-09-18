# Phase 7 — Hop recording

Detailed design doc for Phase 7. `PLAN.md` carries the short checklist;
this file carries the data model, recorder/player wiring, persistence
layout, TDD order, and deferred items.

## Background

Phase 6 made the app an instrument: the user can pick a jam and hop
between rifffs with phase-locked, gapless transitions. Phase 7 turns
those clicks into a saved artifact — a `HopSequence` that captures
*what was played and when*, so it can be reopened and replayed
identically. This is the foundation Phase 8 will edit and Phase 10 will
render to disk.

The recording captures the **timing of user decisions**, not audio
samples. Audio is already addressable: each stem lives in the layered
cache by `StemCouchID`, and each rifff resolves deterministically from
its `RiffDocument`. A `HopSequence` is therefore a sparse, structural
description — a few hundred bytes of JSON for a multi-minute
performance — and replay reconstructs the audio from the same stems
that produced it live.

## Principle: a take is what the performer heard

*Set by the user 2026-09-17.* Every event in a recording lines up with
what the user heard when it happened, not with when they clicked. The
reason is that performing is a feedback loop. Each next move (the next
click, when to make it, which rifff) is a reaction to what's sounding
right now. A take stored in step with the sound keeps each decision next
to the audio that prompted it, so replay makes musical sense. A take
stored in step with the clicks would drift away from that sound whenever
a rifff was slow to load. The later decisions would then replay against
audio the performer never heard them against.

So:

- A hop registers when its rifff **starts playing**, not at the click.
  If the rifff had to load first, the hop is where the sound changed.
- A take **starts** when its first rifff starts playing.
- A quantised hop registers when it was made (once loaded), and is held
  to the same grid on replay, so it enters on the beat it entered on.
- A click that **never played** (overtaken, cancelled or failed) isn't
  in the take.

If what the performer *meant* differs from what they heard (say a
rifff was slow to load and came in late), the Phase 8 editor is where
they correct it. Recording doesn't guess at intent; it keeps the take
in step with the sound, and editing restores the intent.

Ideally the gap never arises. The aim is to pre-load rifffs from the
moment the first one is selected, so a click almost never waits for a
load. That work is Phase 9 in `PLAN.md`; background in
[`phase-6-audio-engine.md`](phase-6-audio-engine.md#pre-cache-strategy).

## Strategy

- **Capture what was heard: a hop registers when its rifff starts
  playing.** A clicked rifff often has to load first, and its row pulses
  yellow while it does. The hop registers once loading finishes and the
  engine acts on it, at the engine's own time for it (`HopResult.atSec`).
  That's what you hear, and replay (which pre-loads) reproduces it. A
  click that never plays (stems unresolvable, `not-ready`, overtaken by a
  newer click, or cancelled by Stop or Record while loading) isn't
  recorded.
- **The latest click wins.** Clicking a second rifff while the first is
  still loading cancels the first, if it hasn't started playing. It
  doesn't matter which finishes loading first: what plays is what the
  user last asked for. (Decided 2026-09-17; before that, whichever
  finished loading last played, even if clicked first.) Its download
  carries on and lands in the cache; only the hop is dropped. A
  quantised hop already scheduled but still held is also replaced (the
  engine drops the held voice; see phase 6). The performance store
  records after `engine.hopTo` succeeds. (Changed 2026-09-17 at the
  user's request. Phase 7 originally recorded every click at the moment
  of clicking, treating the click as the performance, so any loading
  time put the take out of step with what was heard.)
- **Quantised hops replay quantised.** With quantised entry on, the hop
  registers when loading finishes and the engine then holds it to the
  next beat or bar. The event stores that grid (`HopEvent.quantise`), and
  replay asks the engine to hold it again. Replay's grid starts at hop 0,
  as the live one did, so the hop lands on the beat it landed on live.
- **Times in seconds, from the first hop.** Record *arms* the recorder
  (`state: 'armed'`); the take's timeline begins at the first hop, which
  snapshots `t0` (so the take begins when the first rifff starts playing,
  after it loads), so the first event is always `tSec: 0` and every later
  one stores `tSec = now() - t0`. `AudioContext.currentTime` is the clock
  at runtime; tests inject a controllable function. Stopping while still
  armed gives an empty take, which the store doesn't save. (Changed
  2026-09-17. Before that `t0` was the Record click, and every take
  opened with however long the user took to click a rifff, replayed as
  silence. Sequences saved then keep their leading gap.)
- **Every take starts at the beginning of a rifff.** Record stops
  whatever is playing, whether live or a replay, before arming. So the
  first hop is a cold start at offset 0 and the live beat grid begins at
  the same moment as the take. Replay starts its grid at hop 0 too, so
  the two agree. Recording over a rifff that was already playing would
  put the live grid earlier than the take's, and replayed hops would
  land at a different point in the bar from where they were heard.
- **Hop-level transition durations.** `transitionMs` is recorded per
  event, not on the sequence — different hops can use different
  crossfade lengths and replay must honor each.
- **Explicit `durationSec`.** A sequence with one hop and a 30-second
  tail is meaningfully different from a sequence with one hop and no
  tail. We capture the tail by storing the time of `stop()` as
  `durationSec`, separate from the last hop's `tSec`.
- **Rifff-level granularity.** Per-stem mute/solo events are post-v1
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
  reference. It's the performance store that calls `recordHop()`, once
  `engine.hopTo()` has succeeded, passing the engine's `atSec`.
- **Only hops that played are recorded** (see Strategy). Replay
  re-issues the same `hopTo` at the same relative time; the player
  pre-warms a window around each upcoming event so buffering is much
  less likely on replay than it was during the live take. If a rifff
  truly can't be loaded at replay time, the player surfaces an error
  but the sequence as recorded stays intact.
- **One `HopSequence` per file.** No bundle format. Sequences reference
  stems by `StemCouchID`/`RiffCouchID` which are content-addressable;
  the stems live in the layered cache. Phase 10's export step will
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
  // Seconds from the first hop of the recording, so the first event is
  // always 0. (Sequences saved before 2026-09-17 measured from the Record
  // click instead, so their first tSec may be later.)
  tSec: number;
  // The rifff that became active at this moment.
  riffId: RiffCouchID;
  // The jam this rifff belongs to. v1 sequences are single-jam, but we
  // store this per-event so cross-jam recordings are trivial later.
  jamId: JamCouchID;
  // Crossfade duration used at this hop, in ms. 0 for the cold-start
  // event (no previous rifff to fade out).
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
   doesn't. Since 2026-09-17 only a hop the engine played is recorded,
   at its `atSec`; see Strategy.
4. **Storage round-trip with mock `FsAdapter`.** `saveSequence`,
   `listSequences(jamId)`, `loadSequence`, `deleteSequence`. Atomic
   write pattern (write to `.tmp`, rename). Rejects malformed JSON
   and unknown `schemaVersion` with a clear error.
5. **`HopPlayer`.** Drives a mock engine through a fixture sequence
   via a controllable clock + scheduler. Asserts the engine sees
   `hopTo` calls at the right relative times with the right
   `transitionMs`. `stop()` cancels pending hops. Pre-warms a small
   window of upcoming rifffs before each hop.
6. **`useRecorderStore`** — Pinia store wrapping recorder/storage/
   player. Tests assert state transitions and that `play(id)` reloads
   stems via the same `StemResolver` the perform store uses.
7. **`PerformView` UI** — Record button toggles state; saved
   sequences drawer renders + acts. Visual smoke gated on a real
   listen-through, same as Phase 6's checkpoint.

## Deferred (Phase 8+)

- Editing operations (drag hop, change `tSec`/`transitionMs`, delete,
  insert from rifff browser).
- Multi-jam sequences (data model already supports; UI doesn't).
- Stem-level mute/solo per hop.
- Waveform display in the timeline.
- Render to disk (Phase 10).
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
- **What happens when a sequence references a rifff the user no longer
  has access to?** v1: `HopPlayer.play()` rejects with a clear error
  identifying the missing rifff. Phase 8 can surface this in the UI.
