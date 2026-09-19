# Smoke tests

Manual smoke tests to run against the built Tauri app when verifying a
build or after a phase lands. Unit tests (`pnpm test`) cover code
correctness; these cover *feature* correctness — behavior that only a
real listen-through and click-through can verify.

## Prerequisite: host, not container

Launch the Tauri app from the **host** (`pnpm tauri dev` in a host
terminal), not from inside the dev container. The Linux container has
no audio path to the host — stems will download and schedule but you
won't hear anything. Editing, `pnpm test`, and `vue-tsc` are fine
in-container; only manual smoke needs the host.

## How to use this file

Tick a box when the behavior passes in your current build. Untick when
a change lands that might regress it and re-verify. Add new sections as
phases complete. Trim sections that have been stably passing across
many builds if the checklist gets too long.

---

## Phase 5 / 6 baseline

- [x] **Cold start bootstrap splash.** Fresh launch shows "Hoppper /
      spinner / Opening session vault…" until Vue mounts. No blank
      white window during the 30–60s Stronghold open.
- [ ] **Login indicator (manual login).** In the login dialog (Public
      Jams → Log in), submitting credentials shows a spinner + the
      "Endlesss can take 20–60 seconds to respond" hint while the
      round-trip is in flight. *(Moved from `/login` to a dialog in
      Phase 8 Slice A — re-verify.)*
- [x] **Login indicator (saved-token hydrate).** Restart with a valid
      saved token — the same indicator is visible during hydrate.
- [ ] **Jam lists load.** Post-login, Public Jams and My Jams render
      their grids. Titles populate as `getJam` calls resolve. *(Was
      `/jams`; split into two pages in Phase 8 Slice A — re-verify.)*
- [ ] **A jam opens straight into Perform.** Clicking a jam tile opens
      `/jams/:jamId` (the Perform view for now); rifffs list renders and
      Load more pages older ones in. *(The separate jam detail page is
      gone as of Phase 8 Slice A.)*
- [x] **Perform view: audio on cold start.** Open a small jam →
      Perform, click a rifff, hear audio within a couple seconds.
      (Regression signal for the ENOENT / stem cache path.)
- [x] **Perform view: phase-locked hops.** Hopping between adjacent
      rifffs is gapless and beat-aligned; no clicks, no restart, no
      silence between transitions.
- [x] **Hops land on the beat.** With a jam whose rifffs are quantised,
      hop repeatedly at arbitrary moments. Every rifff stays on the same
      beat grid — no lurch, no stumble, whatever the gap between clicks.
      (Regression signal for hops being measured from the previous hop
      instead of the grid: the error is a random fraction of a beat, and
      the *first* hop of a run is always correct even when it's broken,
      so click at least three times.)
- [x] **Quantised entry toggle.** The checkbox in the Perform header is
      off by default and hops enter immediately. Ticked, each hop waits
      for the next beat before the crossfade starts — audible as a
      deliberate entry, and the log line reads
      `quantise=beat +0.xxs`.
- [ ] **DigitalOcean Spaces stems.** Any jam whose stems are hosted at
      `*.digitaloceanspaces.com` plays — no "url not allowed on the
      configured scope" errors in the log panel.
- [ ] **Log out.** Clicking Log out (now in Settings) shows "Logging
      out…" and lands on Public Jams immediately. No multi-second freeze
      while Stronghold saves. *(Moved from a top-right button in Phase 8
      Slice A — re-verify.)*
- [x] **Re-login after logout.** After logging out, logging back in
      with a fresh cred pair works; the previous session token is
      cleared.

### Issues
* I can't quite make out what is happening but 'Perform view: phase-locked hops' isn't working as expected, it's not seamless
  * Diagnosed 2026-07-24/25. Two causes, both fixed; re-tested and
    passing 2026-09-17:
    the outgoing voice was disconnected on the next microtask so no hop
    ever crossfaded; and stems shorter than the rifff's computed loop
    landed at the wrong point in the bar, which sounds like two rifffs
    at once. Re-verify the box above, and watch the log panel for
    `don't fit its … loop` warnings.
* **Quantise toggle sounded backwards: on the beat when off, not when on.**
  (Reported 2026-09-17. Fixed; re-tested and passing 2026-09-17.)
  * Off sounding on the beat is correct: phase locking keeps every hop
    on the grid. Quantise only changes *when* the switch happens.
  * On was broken. The engine worked out the held beat but started the
    new rifff and the crossfade at the click, so there was no audible
    wait and the new rifff played ahead of the grid by the length of
    the hold. Details in `docs/phases/phase-6-audio-engine.md`.
  * With quantise on, also check that Stop during the wait silences
    everything, and that two quick clicks inside one wait go straight
    to the second rifff without a blip of the first.

## Phase 7 — Hop recording

- [x] **Record button visible.** Perform view header shows a **●
      Record** button.
- [x] **Record waits for the first rifff.** Clicking Record flips the
      button to **■ Stop Recording** (red) and shows "Waiting for first
      rifff…". No clock yet. The clock appears at `0:00` when the first
      rifff you click starts playing (after it loads, if it has to) and
      ticks up as `m:ss` from there.
- [x] **Record stops what's playing.** With a rifff playing, click
      Record: the audio stops and the waiting message shows. The first
      rifff you click then starts from its beginning. Same with a saved
      sequence replaying: Record stops the replay.
- [x] **Loading rifffs pulse.** Click a rifff that isn't loaded yet
      (one far from any you've played): its whole row pulses yellow,
      clearly visible, until it starts playing, then stops. Two loading at
      once both pulse.
- [x] **Hops captured as heard.** During a recording, click rifffs that
      have to load. Replay the take: each hop comes in where you heard it
      come in, not where you clicked. A click on a rifff that never
      played (a load error, or one you stopped) isn't in the take.
- [x] **Quantised hops replay on the beat.** Record with "Quantise hops
      to the beat" ticked, clicking at odd moments. On replay each hop
      enters on the same beat it entered on live, whatever the checkbox
      is set to now.
- [x] **Latest click wins.** Click a rifff that has to load, then
      another before the first starts: only the second plays, and the
      first row stops pulsing. It doesn't matter which one finishes
      loading first.
- [x] **Stop while a rifff loads.** Click a rifff that has to load, then
      Stop before it starts: it never starts, and the row stops
      pulsing. Same with Record: it cancels the load and waits for a new
      first rifff.
- [x] **Stop recording writes to disk and silences.** Clicking Stop
      Recording stops the audio and adds the new sequence to the
      **Saved sequences** section with title, duration (mm:ss,
      right-aligned in mono), and a 🗑 button. The duration counts from
      the first rifff clicked, not from Record.
- [x] **Stop ends a recording too.** While recording, the header's Stop
      does the same as Stop Recording: audio stops and the take is saved.
- [x] **Stop before any rifff saves nothing.** Record, then Stop Recording
      without clicking a rifff: no new row appears.
- [x] **Saved sequences persist.** Restart the app, reopen the same
      jam's Perform view — saved sequences reappear.
- [x] **Replay a saved sequence.** Clicking **▶ Play** on a saved row
      starts audio; hops fire at the same relative times as the
      original take with the same crossfade durations. A take recorded
      since the first-rifff change starts sounding straight away, with
      no lead-in silence.
- [x] **Replaying row and rifff are highlighted.** While a sequence
      replays, its saved row is light yellow, and the light-yellow rifff
      row follows each hop as it happens. Same rifff highlight during
      live play.
- [x] **Stop during a replay stays stopped.** Click Stop mid-replay:
      the audio stops and does not come back when the next hop was due.
      The Play buttons re-enable. Also try Stop straight after ▶ Play,
      while the replay is still loading: nothing should start.
- [x] **Replay finishes and Play re-enables.** When a sequence's
      final scheduled stop fires, the Play button re-enables so a
      second sequence can be started immediately.
- [x] **Delete a saved sequence.** Clicking 🗑 removes the row.
      Restart the app — deleted sequence stays gone.

### Issues
Everything below was found on 2026-09-17, fixed, and re-tested and
passing the same day against the boxes above.
* **Stop Recording left the rifff playing, and Stop didn't end a
  recording.** Each button only did half the job. Now both stop the
  audio and any replay, and end and save the recording. Decided
  2026-09-17: while recording they do the same thing.
* **Rifff row highlight was invisible, and wouldn't follow a replay.**
  The `current` class was there, but at `#fafffa`; it's now light yellow
  (`#fff7c2`). The performance store only heard about changes of engine
  *state*, and replay hops the engine directly while it stays
  `playing`. The engine now emits `onRiffChange` on every hop.
* **Stop during a replay restarted playback a moment later.** Stop only
  silenced the engine, so the replay's next scheduled hop started it
  again. Stop now cancels the replay. Also fixed: Stop while a replay
  was still loading didn't prevent it starting, and left the store
  saying "playing".
* **No way to tell which saved sequence was replaying.** Its row is
  now light yellow too (`recorder.playingId`).
* **A loading rifff put the take out of step with what was heard (new
  feature, 2026-09-17).** Clicks were recorded the moment they were
  clicked, but a rifff that has to load starts playing later. Now a
  loading rifff's row pulses yellow, and the hop registers when it
  starts playing, including the take's first hop, which is when the
  recording starts. With quantise on, the hop registers once loaded,
  the engine holds it to the beat, and replay holds it again. A click
  that never plays isn't recorded, and Stop or Record cancel a rifff
  still loading. Decided 2026-09-17: a newer click cancels an older
  one still loading, so the latest click wins.
* **Recording started at Record, not at the first rifff (new
  feature).** Record now arms the recorder and the take begins at the
  first hop, `tSec: 0`. Decided 2026-09-17: every take starts at the
  beginning of a rifff, so Record stops whatever is playing, live or a
  replay. Assumed: Stop while still armed saves nothing, since there's
  nothing to replay. Design notes in
  `docs/phases/phase-7-hop-recording.md`.

## Phase 8 Slice A — shell and jam lists

Design: `docs/phases/phase-8-redesign-and-editor.md`; target look:
`project resources/Design/Canvas/` (published canvas linked from there).

- [x] **Looks like the design.** Dark warm surfaces, Space Grotesk
      headings, the rail on the left, the glass top bar — compare
      gainst the canvas. Fonts load with the network off (they're
      bundled).
- [x] **Opens on Public Jams.** A fresh launch lands on Public Jams.
      Logged out, it shows the striped login prompt instead of a grid;
      My Jams does the same.
- [x] **Login from the dialog.** Log in from either page: the dialog
      closes itself and the grid appears without a reload.
- [x] **My Jams order.** Personal jam first with a Personal badge, then
      joined jams newest first, each saying when it was joined.
- [x] **No repeat fetch.** Switching between Public Jams and My Jams
      doesn't re-request the jam list (watch the log panel's `http`
      lines).
- [x] **Current Jam.** Greyed out until a jam is opened; afterwards it
      returns to that jam, and that jam's tile says Current.
- [x] **Hops.** Lists takes from every jam with jam name, day, hop
      count and length. Play/pause works; Delete asks first; with no
      takes it shows the empty state.
- [x] **Log out from Settings.** Returns to Public Jams logged out,
      Current Jam greys out, and logging in as someone else shows
      their jams, not the previous user's.

### Slice B — rifff splats

- [x] **Splats in stem colours.** Opening a jam shows its rifffs as splats
      grouped by day, each layer in a stem's colour, the committer's initial
      on each. Colours can arrive a moment after the shapes.
- [x] **One request per page.** The log panel shows one `_all_docs` POST
      for the splats when the jam opens, and one more per Load more — not
      one per rifff.
- [x] **Hops cost no stem-document request.** Clicking a splat that's on
      screen plays it without another `_all_docs` POST in the log.
- [x] **Current rifff ringed.** The playing rifff's splat has the amber
      ring; a rifff still loading pulses.

### Slice B — splats from stem audio

- [x] **Splats take their real shape once played.** Before a rifff is
      played its splat has seeded spikes; after you play it, each layer's
      outline is its stem's waveform wrapped round the circle — jagged all
      the way round for every stem, pads included, with long spikes where a
      stem hits — and other splats that reuse those stems change too.
- [x] **No stutter.** Playing a rifff while a long journal is on screen
      doesn't hitch the audio or the playhead when the splats redraw.

### Slice B — mixer, waveform, transport

- [x] **Rifffs play at their own mix.** A rifff with a quiet stem sounds
      as it does in Endlesss — before 2026-09-18 every stem played at full
      volume. Compare a rifff or two against the Endlesss app.
- [x] **Mixer.** Each channel shows the stem's preset name in its colour
      and who made it. A fader drag or arrow key changes that track's
      volume smoothly (no click); mute silences it and remembers the fader.
      Levels and mutes stay put across hops.
- [x] **Waveform.** Rows show the playing rifff's stems, short stems
      repeating across the loop; the playhead sweeps in time with what you
      hear and stays in phase across hops.
- [x] **Transport in the top bar.** Stop, Play (restarts the last rifff),
      Record (only on a jam page); REC badge and clock while recording,
      "Waiting for first rifff…" while armed. Quantise toggle works as the
      old checkbox did.
- [x] **Level meter.** Both bars move with the output — on macOS too (see
      `MEMORY.md` if it stays dark).

## Phase 8 Slice C — hop editor

Rules: `docs/phases/phase-8-redesign-and-editor.md` → "Slice C".

- [ ] **Ways in.** Stop on a recording lands the new take in the editor;
      Edit on the Hops page opens a take; afterwards the rail's Editor goes
      back to it.
- [ ] **Lanes.** Each rifff shows its eight tracks, drawn where the audio
      is — a rifff that came in mid-loop starts mid-waveform. Rifffs load
      without a download if they were played before (log panel).
- [ ] **Lanes appear on first open.** Restart the app, go straight to
      Hops and Edit a take: the waveforms fill in by themselves, without
      clicking anything. (Fixed 2026-09-18: they waited for a redraw when
      the take's rifff documents arrived after it opened.)
- [ ] **Select and drag.** Clicking a hop point splits the lanes, with
      each side running on dashed. Dragging it moves when the next rifff
      comes in, snapped to the beat; Bar and Off change the snap. Other hop
      points don't move. Play afterwards and hear the change on the beat.
- [ ] **Delete.** Delete (or Backspace) on a selected hop point removes
      the rifff it brought in and closes the gap.
- [ ] **Expand and Add.** Expand shows the rifffs the hop skipped, dashed,
      in commit order. **Check the log:** one `rifffLoopsByCreateTime` GET
      with `startkey`/`endkey` — the first time that ranged query has run
      against Endlesss. Pick one and Add puts it in for one loop.
- [ ] **Duplicate.** Pick a rifff, Duplicate: another copy follows it.
- [ ] **Undo/redo and saving.** Ctrl/Cmd+Z undoes, Shift+Ctrl/Cmd+Z
      redoes; edits survive leaving and reopening the take, and the Hops
      page shows the new length and hop count.
- [ ] **Replay doesn't refetch rifffs.** Playing a take twice makes no
      rifff-document requests the second time.

### Solo

- [ ] **Solo one, then more.** S on a track plays only that track; S on a
      second adds it. The others dim in the mixer and the waveform.
- [ ] **Each solo on its own.** Turning one S off leaves the other solos
      playing; turning the last off brings every track back.
- [ ] **Un-solo.** Clears every solo at once and leaves mutes as they
      were. It's greyed out while nothing is soloed.
- [ ] **Mute wins, and solo stays on this page.** A muted track stays
      silent when soloed; a take played in the editor ignores solos.

### Take start and end handles

- [ ] **Grow the start.** Drag the start handle left: the first rifff
      starts earlier (new dashed loop lines appear in it), the take gets
      longer and the rest moves right. Play: the extra time is the first
      rifff looping.
- [ ] **Grow the end.** Drag the end handle right: the last rifff plays on
      for longer, repeating. Drag either handle back in to trim; neither
      goes past the nearest hop point.
- [ ] **Snap and undo.** Both handles follow Beat/Bar/Off, and Ctrl/Cmd+Z
      undoes a resize.
- [ ] **Review: does growing the start feel right?** *(Open question,
      2026-09-18.)* Growing the front moves every later rifff along the
      beat grid, so unless the growth is a whole number of their loops,
      each comes in at a different point in its loop — grow by one bar and
      an 8-bar rifff that entered on its bar 1 now enters on bar 2. Play a
      take after growing its start by a bar, then by a whole loop, and
      decide: keep this, or have the start handle snap to whole loops of
      the first rifff so everything after keeps its place.
- [ ] **End handle scrolls.** Drag the end handle to the right edge of the
      timeline and hold: it scrolls on, and the take keeps growing, faster
      the further into the edge.
- [ ] **Leaving stops playback.** Play a take in the editor, then go to any
      other page: the take stops.

### Independent pages (fixes 2026-09-18)

- [ ] **Mutes stay on the recording page.** Mute a track on Hop Recording,
      open a take in the editor and play it: every track plays. Back on
      Hop Recording, the track is still muted.
- [ ] **Where you left off.** Play a rifff on Hop Recording, go to the
      editor and play a take, come back: the rifff you last played has a
      dashed ring and is in the mixer and waveform. Playing it again turns
      the ring solid amber.

## Phase 10 — WAV export

- [ ] **Save dialog.** Export on a take opens the system Save dialog,
      offering the take's title as the file name, WAV only. Cancel does
      nothing.
- [ ] **The file.** The row says Exporting…, then Saved <name>.wav. The file
      opens in a DAW or player as stereo 24-bit at the app's sample rate,
      exactly as long as the take.
- [ ] **Sounds like replay.** It matches playing the take in the app: the
      same hops at the same moments, crossfaded, on the beat — at each
      rifff's own mix (the recording page's mutes and solos don't apply).
- [ ] **Anywhere you can save.** Export to the Desktop, to a folder with a
      non-English name, and over an existing file.

---

## Cross-tempo stems

Endlesss lets a jam's tempo change mid-session, and rifffs after the
change keep using stems recorded before it. Those stems have to be
played faster or slower to fit — LORE's
`stemTimeScale = riff.BPS / stem.BPS`, which we apply as
`AudioBufferSourceNode.playbackRate`.

**No jam we have tested contains one.** The live probe
(`Stem timing probe` in `packages/sdk/test/integration.test.ts`) checked
14 stems across 4 rifffs and found every stem at its rifff's tempo, so
this path has never run against real data — only unit tests. Hence a
purpose-built jam.

### Setting up the jam (in Endlesss, not Hoppper)

Make it small; we re-download it every time the stem cache is cleared.

1. Start a **private** jam at a clear tempo — say **120 BPM**.
2. Record 2–3 stems (drums, bass, something pitched — pitched parts make
   a wrong rate obvious, drums make wrong *timing* obvious).
3. **Raise the tempo to 144 BPM** with those stems still on, and record
   one new stem at the new tempo. Commit a rifff here: it now mixes
   stems from both tempos (borrowed stems play at 1.2×).
4. **Drop to 90 BPM**, again keeping earlier stems on, and commit
   another rifff. This covers the slowing-down direction (0.75× and
   0.625×) — a different code path in the ear, if not in the code.
5. Commit a couple more rifffs at each tempo so there is something to
   hop *between* at every tempo.
6. Note the jam ID; add it to `packages/sdk/.env.local` as
   `HOPPPER_TEST_JAM_ID` so the probe can inspect it too.

### What to verify

- [ ] **Probe sees the cross-tempo stems.** In the container:
      `HOPPPER_PROBE_RIFF_COUNT=4 pnpm --filter @hoppper/sdk test
      integration -t "Stem timing probe"`. The summary line reports one
      or more **stem/riff tempo difference(s)** and lists them. If it
      reports none, the jam didn't capture what we wanted — check that
      the later rifffs really do reuse the earlier stems.
- [ ] **Borrowed stems play in time.** Play a rifff from step 3. The
      carried-over stems sit on the same grid as the new one — no
      flam, no drift over repeats, no doubling.
- [ ] **Borrowed stems play in tune-ish.** Rate-scaling shifts pitch
      (as it does in Endlesss itself, and in LORE). A 1.2× stem sounds
      a little sharp; that is correct behaviour, not a bug. What's
      wrong is a stem that *drifts* against the beat.
- [ ] **Log line shows the scaling.** The hop line in the log panel
      reads e.g. `… stems=4 crossfade=250ms scaled=2/4 (1.200×,
      1.200×)`. Rifffs whose stems are all at their own tempo have no
      `scaled=` segment at all.
- [ ] **Hops across a tempo change.** Hop from a 120 BPM rifff to a
      144 BPM one and back. Each lands phase-locked on its own grid,
      the crossfade is smooth, and nothing lurches or restarts.
- [ ] **Slowed stems too.** Repeat on the 90 BPM rifffs from step 4 —
      rates below 1 are the case most likely to expose a sign error.
- [ ] **No spurious damage warnings.** The log shows no
      `audio is not the declared length` warnings for this jam. Those
      compare `length16ths` against the decoded buffer, and a false
      positive there would mean our tempo maths is off, not the file.
