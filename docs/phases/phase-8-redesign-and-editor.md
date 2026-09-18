# Phase 8 — UI redesign and the hop editor

The Phase 8 timeline editor ships as part of a whole-app redesign on the
LwlkcIng design system. The source of truth for the look and the flows is the
design canvas: `project resources/Design/Canvas/Main.dc.html` (published at
https://claude.ai/artifact/DG5RrdPN1TJBudUkFHQShU), drawn from the sketches in
`project resources/Design/`. The design system itself lives on claude.ai/design
(see `MEMORY.md` → "UI redesign").

The work lands in three slices, each ending with a checkpoint.

## Flows (from `project resources/Design/Design Plan.md`)

- The app opens on **Public Jams**. Logged out, Public Jams and My Jams show a
  login prompt instead of a list, because both lists need a session
  (`listJams` → `requireValidSession`). Logging in is a dialog, not a route.
- Clicking a jam opens **Hop Recording** for it. The rail's **Current Jam**
  returns to the last jam opened.
- Stopping a recording opens the new take in **Hop Editing**.
- **Hops** lists every saved take, across jams, with play, edit and delete.
- **Settings** holds Log out. Account and the metronome are not designed yet.

## Slice A — shell, jam lists, Hops, Settings

- Design tokens and base styles from the design system in
  `packages/app/src/styles/` (the token files are copied as-is, so a later
  sync is a diff). Fonts are bundled with the app (`@fontsource/*`) so the UI
  looks the same offline.
- `AppShell`: top bar (logo, transport, level meter, quantise, settings) and
  nav rail (Current Jam, My Jams, Public Jams, Hops, Editor, Account).
- Routes: `/` → `/public`; `/public`, `/mine`, `/hops`, `/settings` are open
  to a logged-out user, and the jam routes redirect a logged-out user to
  `/public`. `/login` goes away; `LoginDialog` keeps what `LoginView` did (the
  20–60 s hint, the auth error).
- Jam tiles use a cover generated from the jam ID: Endlesss jam profiles
  carry no image (neither ours nor LORE's `JamProfile` has one).
- Hops needs every take, not one jam's: `SequenceStorage.listAllSequences()`
  walks `sequences/<jamId>/`.
- Hop Recording is the existing Perform view inside the new shell until
  Slice B replaces it.

**Checkpoint A**: the app opens on Public Jams, logs in from the dialog,
browses both jam lists, opens a jam into Perform, and lists, replays and
deletes takes from Hops.

## Slice B — Hop Recording

- Rifff history as splats, grouped by day, the current rifff ringed.
- Eight-track mixer (mute, volume) — needs per-slot gain in `RiffVoice`.
- Waveform of the playing rifff with a phase-true playhead, drawn from the
  decoded `AudioBuffer`s the engine already holds (peaks are a pure function
  of a buffer, so they are cheap to test).
- Top-bar transport, record and quantise wired to the performance and
  recorder stores; a level meter from an `AnalyserNode` on the master bus.

**Splats are drawn from stem colours** (decided by the user 2026-09-18). Each
active stem is a spiky layer in its stem document's `primaryColour` (eight hex
digits, alpha first — LORE's `ParseHexColour`), louder stems larger and
underneath; the spikes are seeded by stem ID for now (`ui/splat.ts`). The
journal asks for its rifffs' stem documents in one batched `_all_docs`
request per page, through a store that keeps every document by ID and never
asks twice (`stores/stem-docs.ts`). Hops resolve their stems through the same
store, so a hop on a rifff that's on screen costs no request — the in-memory
half of Phase 9's "stop re-fetching immutable data".

Built: the journal (days newest first, splats newest first within a day, the
committer's initial, the current rifff ringed, Load more at the foot) in the
Hop Recording layout.

**The mix** (2026-09-18). Each stem now plays through its own gain at the
rifff's slot gain, times the mixer's level for that slot — LORE's
`stemGains[i] × m_layerGainMultiplier[i]` (`r4.toolbox/mix/preview.cpp`).
Before this the engine ignored the slot gains, so every rifff played every
stem at full volume rather than as it was committed. The mixer's levels and
mutes belong to the slots and hold across hops, as LORE's multipliers do.
`placeStems` (`audio/slots.ts`) puts each resolved stem back in its slot so
the mixer can reach it.

**Mixer** (`MixerPanel`): eight channels — mute lamp, vertical fader
(pointer drag or arrow keys), the stem's preset name in its colour, and who
made it — for the playing rifff.

**Waveform** (`LoopWaveform`): a row per slot drawn from the decoded buffer's
peaks, tiled across the rifff's loop the way short stems repeat, with bar
numbers and a playhead read from `engine.playhead()` every frame — the same
continuous grid hops use, so it sits where the audio is.

**Transport** (`TransportBar`, in the top bar): Stop, Play (starts the last
rifff again), Record (only on Hop Recording, which has a jam), the REC badge
and clock, a stereo level meter from analysers on a new master bus, and the
Quantise toggle. Hop Recording lost its own controls and saved-takes list;
the Hops page lists takes.

**Splats from audio** (2026-09-18). Once a stem has been decoded its splat
layer is its waveform wrapped once around the circle: the highest then the
lowest sample of each of 128 slices of the rifff's loop, peaks reaching out
and troughs cutting in (`waveRing` in `ui/riff-audio.ts`). That is what a
waveform display draws, bent round — jagged all the way round for every
stem, pads included, with long spikes where a stem hits hard. (A first cut
drew the loudness envelope instead, which smoothed pads into circles; the
user corrected it the same day.) Each layer is normalised to its stem's own
largest swing so a quiet stem still shows its waveform, and short stems
repeat round the loop as they play. A stem not decoded yet keeps its seeded
spikes; decoding happens when a rifff is played, so splats settle into their
real shapes as you play, and a stem reused across rifffs reshapes all of
them. The journal remembers each rifff's splat and redraws it only when one
of its stems' documents or audio arrives (`performance.decodedTick` moves
each time a rifff starts).

Still to do: opening a stopped take in Hop Editing (Slice C).

## Slice C — Hop Editing (the Phase 8 editor)

Signed off by the user 2026-09-18 (the drawn rules come from the sketches in
`project resources/Design/`; the rest were asked and answered).

**Model.** A take (`HopSequence`) is read as segments: segment *k* is
`hops[k].riffId` from `hops[k].tSec` to the next hop's `tSec` (the last runs
to `durationSec`). Hop point *k* is where segment *k* begins (k ≥ 1). Every
operation is a pure function over the take, so each is unit-tested on its
own and undo is a stack of takes.

**Rules.**

- **Drag a hop point** — only the two rifffs either side change: dragging
  left makes the incoming rifff start earlier and play longer; every later
  hop point keeps its time. (Drag sketch; user choice.)
- **Snap** — to beats on the take's grid by default, with a toggle for bars
  or no snapping. The grid is the one playback uses: continuous from the
  take's first rifff; a beat is the incoming rifff's beat.
- **Delete a hop point** — removes the rifff that point brought in; every
  later hop point moves left by its length, so the one after follows the
  rifff before. (Delete sketch.)
- **Expand** at a selected hop point — shows the rifffs committed to the jam
  between the rifffs either side, in commit order: the ones the hop skipped.
  Their stems download only now, since they were never played.
- **Add** a skipped rifff — inserts it at the hop point for one loop of its
  length; later hop points move right. Drag to adjust from there.
- **Duplicate** a rifff in the take — inserts a copy right after it for one
  loop of its length; later hop points move right.
- **Saving** — edits change the take and are saved as they happen; undo and
  redo walk back through the session's edits.
- **Crossfades** stay at each hop's recorded `transitionMs`; editing them is
  deferred (still listed in `PLAN.md`).
- **Stopping a recording** opens the new take in the editor.

**Built so far** (2026-09-18): the operations, in `src/hop-editor/edits.ts`,
and undo/redo in `src/hop-editor/history.ts`. Hop points are placed at their
*arrival* — when the crossfade ends and the new rifff is fully in, which for
a quantised hop is the beat or bar replay holds it to — because that is what
is heard. A dragged hop snaps its arrival to the beat (as a quantised hop
lands) and is stored as an exact time with its `quantise` dropped, so replay
doesn't hold it again; hops moved by a ripple (Delete, Add, Duplicate) keep
their exact arrival relative to the edit the same way.

**Built** (2026-09-18, steps 2–3). `stores/hop-editor.ts` opens a take,
applies each operation, saves it at once and keeps the undo history;
coming back to the take already open keeps that history. The ways in: Edit
on the Hops page, the rail's Editor (the last take opened), and Stop on a
recording, which lands the new take in the editor. `HopEditingView` draws the
layout from `hop-editor/layout.ts`: one lane, or two around a selected hop
point with each side running on dashed, or the skipped rifffs laid in after
the point when expanded. Lanes fill the timeline's height — two share it around a selected hop
point, one takes it all (`laneGeometry`, measured as the window resizes;
changed at the user's request 2026-09-18, when fixed 16 px tracks left them
small). Lanes are drawn phase-true (`phaseRow`): at each
moment, the rifff at the grid's position then. Dragging a hop point shows the
edit as it moves and makes it on release (a click without a move isn't an
edit). Snap is Beat / Bar / Off; undo is the buttons or Ctrl/Cmd+Z (redo:
Shift, or Ctrl+Y); Delete/Backspace deletes the selected point; Escape
clears. Play replays the take (`HopPlayer`, which now reports its position
for the playhead).

Expand asks Endlesss for the rifffs committed between the two either side —
one ranged request on the create-time view
(`EndlesssClient.getRiffIdsBetween`, CouchDB `startkey`/`endkey`, at most 32
shown) — then their documents, then their stems. Rifff documents now go
through `stores/riff-docs.ts`, which keeps them by ID: replay no longer
fetches each rifff again per hop.

**Drawing.** Stacked tracks for each segment, split into two lanes around a
selected hop point (outgoing rifff continuing, incoming rifff's run-in, both
dashed), drawn from cached buffers. Playback is phase-locked to one
continuous grid, so what a segment shows at time *t* is its rifff at the
grid's position then, not from its loop start — the lanes draw what will be
heard. Playback through `HopPlayer`.
