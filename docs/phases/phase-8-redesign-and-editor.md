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
Hop Recording layout. Still to come in Slice B: the mixer, the waveform, the
top-bar transport and meter, and splat spikes drawn from the stems' audio once
waveform peaks exist.

## Slice C — Hop Editing (the Phase 8 editor)

- A take becomes a list of segments, one per hop, with hop points between
  them. Operations are pure functions over that list: move a hop point,
  delete a hop point (drops the rifff it introduced), expand (the rifffs
  skipped between two neighbours), add a skipped rifff, duplicate a rifff.
- Timeline of stacked tracks with split lanes around a selected hop point,
  drawn from cached buffers; playback through `HopPlayer`; undo/redo; saving
  back through `SequenceStorage`.

The interaction rules above are the design canvas's reading of the sketches
and still need the user's sign-off before Slice C starts.
