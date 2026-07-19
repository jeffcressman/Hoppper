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

- [ ] **Cold start bootstrap splash.** Fresh launch shows "Hoppper /
      spinner / Opening session vault…" until Vue mounts. No blank
      white window during the 30–60s Stronghold open.
- [ ] **Login indicator (manual login).** On `/login`, submitting
      credentials shows a spinner + the "Endlesss can take 20–60
      seconds to respond" hint while the round-trip is in flight.
- [ ] **Login indicator (saved-token hydrate).** Restart with a valid
      saved token — the same indicator is visible during hydrate.
- [ ] **Jam list loads.** Post-login `/jams` renders the subscribed
      jams. Titles populate as `getJam` calls resolve.
- [ ] **Jam detail loads.** Clicking a jam opens `/jams/:jamId`; riffs
      list renders.
- [ ] **Perform view: audio on cold start.** Open a small jam →
      Perform, click a riff, hear audio within a couple seconds.
      (Regression signal for the ENOENT / stem cache path.)
- [ ] **Perform view: phase-locked hops.** Hopping between adjacent
      riffs is gapless and beat-aligned; no clicks, no restart, no
      silence between transitions.
- [ ] **DigitalOcean Spaces stems.** Any jam whose stems are hosted at
      `*.digitaloceanspaces.com` plays — no "url not allowed on the
      configured scope" errors in the log panel.
- [ ] **Log out.** Clicking Log out (top-right) shows "Logging out…"
      and navigates to `/login` immediately. No multi-second freeze
      while Stronghold saves.
- [ ] **Re-login after logout.** After logging out, logging back in
      with a fresh cred pair works; the previous session token is
      cleared.

## Phase 7 — Hop recording

- [ ] **Record button visible.** Perform view header shows a **●
      Record** button.
- [ ] **Start recording.** Clicking Record flips the button to **■
      Stop Recording** (red) and an elapsed-time clock appears next
      to it, ticking up as `m:ss`.
- [ ] **Hops captured while recording.** Clicking through riffs
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
