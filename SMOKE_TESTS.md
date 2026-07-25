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
- [x] **Login indicator (manual login).** On `/login`, submitting
      credentials shows a spinner + the "Endlesss can take 20–60
      seconds to respond" hint while the round-trip is in flight.
- [x] **Login indicator (saved-token hydrate).** Restart with a valid
      saved token — the same indicator is visible during hydrate.
- [x] **Jam list loads.** Post-login `/jams` renders the subscribed
      jams. Titles populate as `getJam` calls resolve.
- [x] **Jam detail loads.** Clicking a jam opens `/jams/:jamId`; rifffs
      list renders.
- [x] **Perform view: audio on cold start.** Open a small jam →
      Perform, click a rifff, hear audio within a couple seconds.
      (Regression signal for the ENOENT / stem cache path.)
- [ ] **Perform view: phase-locked hops.** Hopping between adjacent
      rifffs is gapless and beat-aligned; no clicks, no restart, no
      silence between transitions.
- [ ] **Hops land on the beat.** With a jam whose rifffs are quantised,
      hop repeatedly at arbitrary moments. Every rifff stays on the same
      beat grid — no lurch, no stumble, whatever the gap between clicks.
      (Regression signal for hops being measured from the previous hop
      instead of the grid: the error is a random fraction of a beat, and
      the *first* hop of a run is always correct even when it's broken,
      so click at least three times.)
- [ ] **Quantised entry toggle.** The checkbox in the Perform header is
      off by default and hops enter immediately. Ticked, each hop waits
      for the next beat before the crossfade starts — audible as a
      deliberate entry, and the log line reads
      `quantise=beat +0.xxs`.
- [ ] **DigitalOcean Spaces stems.** Any jam whose stems are hosted at
      `*.digitaloceanspaces.com` plays — no "url not allowed on the
      configured scope" errors in the log panel.
- [x] **Log out.** Clicking Log out (top-right) shows "Logging out…"
      and navigates to `/login` immediately. No multi-second freeze
      while Stronghold saves.
- [x] **Re-login after logout.** After logging out, logging back in
      with a fresh cred pair works; the previous session token is
      cleared.

### Issues
* I can't quite make out what is happening but 'Perform view: phase-locked hops' isn't working as expected, it's not seamless
  * Diagnosed 2026-07-24/25. Two causes, both fixed, awaiting re-test:
    the outgoing voice was disconnected on the next microtask so no hop
    ever crossfaded; and stems shorter than the rifff's computed loop
    landed at the wrong point in the bar, which sounds like two rifffs
    at once. Re-verify the box above, and watch the log panel for
    `don't fit its … loop` warnings.

## Phase 7 — Hop recording

- [x] **Record button visible.** Perform view header shows a **●
      Record** button.
- [ ] **Start recording.** Clicking Record flips the button to **■
      Stop Recording** (red) and an elapsed-time clock appears next
      to it, ticking up as `m:ss`.
- [ ] **Hops captured while recording.** Clicking through rifffs
      during a recording adds events to the sequence, including any
      clicks flagged not-ready — the click itself is the artifact.
- [ ] **Stop recording writes to disk.** Clicking Stop Recording adds
      the new sequence to the **Saved sequences** section with title,
      duration (mm:ss, right-aligned in mono), and a 🗑 button.
- [ ] **Saved sequences persist.** Restart the app, reopen the same
      jam's Perform view — saved sequences reappear.
- [ ] **Replay a saved sequence.** Clicking **▶ Play** on a saved row
      starts audio; hops fire at the same relative times as the
      original take with the same crossfade durations.
- [ ] **Replay finishes and Play re-enables.** When a sequence's
      final scheduled stop fires, the Play button re-enables so a
      second sequence can be started immediately.
- [ ] **Delete a saved sequence.** Clicking 🗑 removes the row.
      Restart the app — deleted sequence stays gone.

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
