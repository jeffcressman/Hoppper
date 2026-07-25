# MEMORY.md

Durable notes for Claude Code on this project — things learned by working on
it that aren't obvious from the code, and that would otherwise be re-derived
the hard way each session.

**Read this at the start of every session; add to it at the end of one.**
See `CLAUDE.md` → "Working memory" for what belongs here and what doesn't.

Newest entries at the top of each section. Date entries absolutely
(YYYY-MM-DD), never "recently" or "last time".

---

## Web Audio behaviours that bit us

*2026-07-24, from the "two rifffs playing at once" investigation.*

- **`disconnect()` silences a node instantly — it is not a teardown you can
  schedule early.** A voice that has a fade and a `stop()` scheduled is still
  cut dead the moment its nodes are disconnected. Anything that fades must
  survive, connected, until the fade has actually landed. We were disposing
  the outgoing voice on the next microtask, so no hop ever crossfaded — every
  hop was a hard cut. Teardown now happens in `RiffVoice.stop()` via
  `onended` on the sources, which the browser fires when the scheduled stop
  takes effect.
- **`loopEnd` beyond the end of a buffer is silently ignored** — Web Audio
  just loops at the end of the buffer instead. So a too-long `loopEnd` doesn't
  error, it quietly gives each stem a different loop length.
- **A `start()` offset larger than the buffer is clamped by the browser**, so
  a stem asked to start past its own length lands at its end/start rather than
  at the equivalent point in the bar. Combined with the previous point, this
  is how the stems of a *single* rifff end up at different points in the bar
  and sound like two rifffs layered out of sync. Offsets must be wrapped into
  each stem's own loop before being passed to `start()`.
- **Non-finite values throw**: assigning `NaN`/`Infinity` to `loopEnd`, or
  passing one as a `start()` offset or an `AudioParam` time, raises. A throw
  part-way through starting a voice leaves the rest of the hop unscheduled and
  nodes connected — i.e. it *would* leak audio. Guard the arithmetic at the
  boundary; `riff-voice.ts` does this now (`wrapOffset`, `usableLoop`).
- **`setValueAtTime` does not cancel automation already on the timeline.** A
  fade scheduled while an earlier ramp is still pending can be overtaken by
  it. Always `cancelScheduledValues(t)` first, then anchor the current value,
  then ramp.
- `AudioContext.currentTime` does not advance while the context is suspended,
  and the context starts suspended until a user gesture (`unlockAudioContext`
  is called from `resolveStems`, before any hop scheduling).

## Rifff and stem timing

- **`computeRiffTiming` is a heuristic, not ground truth.** It mirrors LORE's
  formula from `bps` + `barLength`, which lands on 8 bars for essentially
  every real rifff (any loop under 60s). The stems a rifff actually holds may
  be shorter.
- **The loop that matters for phase math is `RiffVoice.effectiveLoopSec`** —
  derived from the decoded buffers, not from `computeRiffTiming`. The engine
  stores that on `ActiveVoice.loopDurationSec` and feeds it to `computeHop`.
  If you add another code path that hops, phase-lock against that, not the
  computed riff loop.
- **A single rifff routinely mixes stems of different lengths.** Measured
  2026-07-25 by the live probe (`Stem timing probe` in
  `packages/sdk/test/integration.test.ts`, 14 stems across 4 rifffs of one
  jam): one rifff held a 1-bar stem (`length16ths` 16), a 2-bar stem (32) and
  four 4-bar stems (64) together. This is the condition behind the
  "two rifffs at once, out of sync" report — with a hop offset past a short
  stem's length, the browser clamps it and that stem lands at the wrong point
  in the bar while the long ones land correctly.
- **`computeRiffTiming` is only the *starting* length, and LORE says so.**
  `live.riff.cpp` ("this may mutate as we learn more about the stems"):
  - initial length from `bps`/`barLength` with the 8-segment/60s clamp — this
    is what `computeRiffTiming` ports, faithfully;
  - then `m_lengthInSec = max(computed, longest time-scaled stem)` — the rifff
    is **pushed out** to fit its longest stem, never shortened below the
    computed value;
  - short stems repeat inside it: `repeats = round(riffLen / stemLen)`.
  `RiffVoice` follows this: each source loops at its own stem length and
  `effectiveLoopSec` is `max(computed, longest stem)`. An earlier version of
  mine capped the loop at the computed length, which truncated any stem longer
  than it and put hops on the wrong grid — fixed 2026-07-25.
  A rifff whose stem length doesn't divide the loop evenly can't line up on
  every repeat; the engine logs a warning naming those stems.
  Measured: a rifff at `bps` 2.4 / `barLength` 16 computes 13.33s while its
  only stem holds 3.33s — so it repeats 4× inside the rifff.
- **`ResolvedStem` carries `bps` and `length16ths`, and its byte size is
  `byteLength`** (renamed 2026-07-25 — `length` next to `length16ths` read as a
  duration and misled me once). The engine turns `riff.bps / stem.bps` into
  `AudioBufferSourceNode.playbackRate`, which is LORE's `stemTimeScale`;
  `length16ths / 4 / bps` is checked against the decoded buffer and a
  disagreement is logged as a damaged/truncated stem. The stem document's
  `sampleRate` is deliberately **not** carried: see below.
- What the live probe found about the two things this plumbing was feared to
  need:
  - **Declared `sampleRate` matched the encoded rate on 14/14 stems** (48000,
    ratio 1.000000), so `decodeAudioData` — which resamples from the *file's*
    rate — is already doing what `docs/protocol/overview.md:537` describes
    LORE doing with r8brain. The "stems play at the wrong speed and drift"
    worry raised 2026-07-24 is **unsupported by evidence** on this jam. Don't
    build resampling on the strength of that doc line alone; re-run the probe
    on a suspect jam first.
  - **`bps` was the real gap** — closed 2026-07-25. LORE `live.riff.cpp`:
    "stems can be used across riffs with changed tempos, we have to scale to
    cope" — `stemTimeScale = riff.BPS / stem.BPS`, applied to the stem's
    sample count (`timeScaledSampleCount = sampleCount / stemTimeScale`)
    *before* the rifff length is worked out. The probe found no cross-tempo
    stems in its 14 (only float32 noise), so this was latent rather than
    audible, but it is what the doc line at
    `docs/protocol/overview.md:537` was really pointing at.
    - `bps` is a float32 on the wire, so the same tempo differs in the last
      few digits between documents (2.4000000953674316 vs 2.400015115737915,
      ~6ppm). Compare tempos relatively; that is not a cross-tempo stem.
  - **`length16ths / 4 / bps` matched the encoded duration on 14/14 stems**, to
    the millisecond. Loop length still comes from the decoded buffer, because
    that is what LORE uses too (`loopStem->m_sampleCount`, not the document) —
    the audio is the truth and the metadata is the cross-check.
- A cold start always sounds right (offset 0); timing bugs only surface on the
  *second* and later hops. Don't conclude "audio works" from one click.

## Debugging technique that worked

- **"Does Stop silence it?" separates a leaked voice from a misaligned one.**
  `engine.stop()` only stops and disposes `current.voice`, so anything still
  audible after Stop is a voice the engine has lost track of. If Stop kills
  everything, all the sound was coming from one voice and the problem is
  *inside* a rifff — its stems landing at different points in the bar — not
  two rifffs overlapping. Confirmed by the user 2026-07-25 for the
  "two rifffs at once" report: Stop silenced everything, so it was intra-voice
  misalignment, and rifffs reusing the previous rifff's stems is what made it
  sound like the two rifffs they had clicked.
- **Model audibility, don't just assert calls.** `test/audio/hop-audibility.test.ts`
  has a mock `AudioContext` that tracks, per source: started / scheduled stop /
  still connected / its voice's gain automation — so a test can ask "which
  stems are making sound at time *t*". That is what proved the crossfade never
  ran, and what ruled out a leaked voice by driving the real store + engine
  through every ordering of overlapping clicks. Reach for it before theorising
  about audio bugs.
- The in-app log panel is the primary field instrument. `createAudioEngine`
  takes a `logger` and emits one line per hop (offset, effective loop, prev
  loop, stem count, crossfade) plus warnings for `not-ready` hops and for
  rifffs whose stems are shorter than their computed loop. When a user reports
  an audio oddity, ask for those lines first.
- Timestamps in the log panel are wall-clock (`Date.now()`), while all audio
  scheduling is in `AudioContext.currentTime`. Don't compare them directly.

## Live probes against real jams

- `packages/sdk/test/integration.test.ts` holds the opt-in live tests, gated on
  `HOPPPER_RUN_LIVE_TESTS=1` **plus** credentials in `packages/sdk/.env.local`.
  As of 2026-07-25 that file is populated in this container, so live tests
  really do run on a plain `pnpm --filter @hoppper/sdk test` — expect real
  requests, and don't add live cases casually.
- **`Stem timing probe`** compares a stem document's claims against the bytes:
  declared vs encoded sample rate, and `length16ths / 4 / bps` vs the encoded
  duration. Header parsing is in `test/helpers/audio-header.ts` (Ogg Vorbis
  ident packet + final-page granule; FLAC STREAMINFO bit field) with its own
  unit tests. `HOPPPER_PROBE_RIFF_COUNT` widens the sample, capped at 4 rifffs
  because it downloads every stem of each one. Reach for this whenever a
  timing question is really a question about data.
- **No jam we have tested contains a cross-tempo stem** (probe, 14 stems,
  2026-07-25), so the `playbackRate` scaling path has never run against real
  data. `SMOKE_TESTS.md` → "Cross-tempo stems" has instructions for building a
  jam that exercises it; until that is ticked off, treat rate-scaling as
  unit-tested only.
- Deriving a stem's true length needs no extra requests: `getStemDocuments`
  already returns everything, and `resolveStemUrl` can build the URL from the
  document you already hold — calling `getStemUrls` as well repeats the
  identical `_all_docs` POST.

## Known gaps / deliberately not done yet

- **Concurrent Hop clicks aren't serialised** (`stores/performance.ts`). The
  `hopping` guard in `PerformView` only disables the button you clicked, and
  `hopTo` awaits stem resolution, so of two clicks in flight whichever
  resolves *last* wins — even if it was clicked first. Needs a supersede check
  plus a new `HopResult` kind for the UI. Raised with the user 2026-07-24;
  awaiting a decision.
- Storage-management UI (eviction policy, per-jam totals, "clear cache") is
  post-v1 — see `CLAUDE.md`.

## Build and dev loop

- **The app consumes the SDK's `dist/`, not its source.** `@hoppper/sdk`'s
  `exports` point at `./dist/index.js`, so `vue-tsc` and the running app both
  read the tsup output — while vitest resolves `packages/sdk/src` directly.
  That asymmetry means **SDK tests can pass on a change the app cannot see**.
  After any SDK change, `pnpm --filter @hoppper/sdk build` before typechecking
  the app or trusting what the app does; stale-`dist` type errors name app
  files and look baffling.
- `pnpm dev` (root) builds the SDK once, then runs `pnpm -r --parallel dev`:
  tsup `--watch` for the SDK alongside `tauri dev` for the app. Added
  2026-07-25 — before that, SDK edits were silently invisible to a running
  app. Measured: an SDK source edit rebuilds `dist/index.js` in ~30ms (types
  ~800ms), and `dist/` is never emptied mid-run (tsup's `clean` runs only on
  the first build and its watcher ignores `dist`).
- `pnpm dev` must run on the **host**, not in this container — see
  `SMOKE_TESTS.md`; the container has no audio path.

## Environment quirks (dev container)

- **`/refs/OUROVEON` is mounted and fine.** On 2026-07-24 I concluded it was
  missing; it wasn't. The real cause: LORE's source tree is now
  `src/r3.endlesss/` (was `r0.endlesss`, which `CLAUDE.md` still documented),
  and the `ls`/`grep` that would have said "no such directory" had
  `2>/dev/null` on it. **Never suppress stderr on an exploratory path check** —
  a wrong path then looks identical to a missing mount, and the wrong
  conclusion propagated into a whole recommendation. Verify with
  `ls /refs/OUROVEON/src`, and see the mount table in `/proc/self/mountinfo`
  if you doubt it (host `<parent>/OUROVEON` → `/refs/OUROVEON`, virtiofs, ro).
- **`pnpm lint` cannot run here**: `typescript-eslint` isn't installed in the
  container, so ESLint fails to load its config in both packages. Pre-existing
  and unrelated to any change; verify with `vitest` + `vue-tsc` instead.
- **The SDK typecheck has two pre-existing failures** (confirmed against a
  clean checkout 2026-07-25), both in test files, so `pnpm --filter
  @hoppper/sdk exec tsc --noEmit` — what CI runs — is already red:
  `test/client.test.ts:328` passes `maxAttempts`, which isn't in `RetryPolicy`;
  `test/stems/fetcher.test.ts:15` passes a `Uint8Array` where a `BodyInit` is
  wanted (a lib.dom typing change). Don't mistake these for your own.
- CI (`.github/workflows`) typechecks the app with **`vue-tsc --noEmit`**, not
  plain `tsc` — bare `tsc` reports spurious "cannot find module './App.vue'"
  errors. Use `pnpm --filter @hoppper/app exec vue-tsc --noEmit`.
