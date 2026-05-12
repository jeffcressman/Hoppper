# PLAN.md

Phased roadmap. Each phase ends with a checkpoint — pause for user review before moving on.

## Development approach

Test-driven development from Phase 2 onward. For each piece of behaviour:

1. Write the failing test
2. Watch it fail for the right reason
3. Write the minimum code to make it pass
4. Refactor
5. Commit

Phase checkpoints below describe **outcomes**, not implementation order. Within each phase, work in small TDD cycles. Phases 0 and 1 are exempt — they're reading/scaffolding work where tests come alongside, not before.

---

## Phase 0 — Reconnaissance

**Goal**: understand what we're actually targeting before writing any product code.

- [x] Read `../OUROVEON/src/r0.endlesss/` end to end. Produce `docs/protocol/overview.md` summarising:
  - Base URLs and authentication flow (login, session, token refresh)
  - Public-only "fallback" endpoint set vs authenticated endpoint set
  - Core data shapes: `Jam`, `Riff`, `Stem`, `Shared Riff`
  - WebSocket protocol (the one BEAM/LORE use for pushing riff sequences)
  - Known quirks / damaged-data handling LORE accounts for
- [x] Check LORE's git log since August 2025 for any commits related to Hablab's reactivated servers. Note any endpoint changes.
- [x] Decide: do we support unauthenticated public-endpoints mode in v1, or auth-only? **Decision: auth-only.**

**Checkpoint**: ~~protocol overview reviewed with user. Confirm scope.~~ ✓ Done 2026-05-12.

---

## Phase 1 — Monorepo scaffold

**Goal**: empty but correct shells for both packages, CI green.

- [x] pnpm workspace at root. `packages/sdk` (publishable as `@hoppper/sdk`) and `packages/app`.
- [x] `packages/sdk`: tsup for build, vitest for tests, strict TS, ESLint, prettier. Publishable shape (`exports`, `types`, `files`).
- [x] `packages/app`: Tauri 2.x + Vue 3 + Vite scaffold. Add Pinia for state, Vue Router if needed later.
- [x] Root scripts: `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm lint`.
- [x] Basic GitHub Actions: typecheck + test on push.
- [x] `.gitignore` covers `node_modules`, `dist`, `target/`, `.env.local`, `reference/`.

**Checkpoint**: `pnpm dev` opens an empty Tauri window with a Vue page; `pnpm test` passes on an empty SDK.

---

## Phase 2 — SDK: auth & HTTP foundation

**Goal**: a logged-in session against live Endlesss servers.

- [x] `EndlesssClient` class — accepts base config, exposes auth + request methods.
- [x] HTTP transport with: retry/backoff, request logging, configurable fetch (so Tauri can inject its CORS-free fetch).
- [x] Login flow → session token. (No refresh endpoint exists; SDK exposes `isSessionExpired` and surfaces `AuthError` so callers can re-prompt.)
- [x] Token storage: define an interface (`TokenStore`), provide in-memory + simple file impls in the SDK. App will plug in Tauri keychain later.
- [x] First real endpoint: `getSubscribedJams()` — hits CouchDB with the Basic auth keypair from login, proving the full credential chain works.
- [x] Test against a real account (creds via `packages/sdk/.env.local`).

**Checkpoint**: ~~a vitest integration test logs in and fetches the user profile.~~ ✓ Done 2026-05-12 — live login + 98 subscribed jams fetched.

---

## Phase 3 — SDK: jam & riff data

**Goal**: list jams, get riffs, get stem URLs.

- [ ] `listJams()` — subscribed jams, solo jam, public jams.
- [ ] `getJam(jamId)` — metadata.
- [ ] `getRiffs(jamId, opts)` — paginated; handle the 50,000+ riff case via streaming/cursor.
- [ ] `getStemUrls(riff)` — resolve the 8 stem download URLs and their formats (Ogg/FLAC).
- [ ] Types for everything in `packages/sdk/src/types/`.
- [ ] Tests against a known small jam.

**Checkpoint**: SDK can enumerate a jam and produce playable stem URLs.

---

## Phase 4 — SDK: stem fetching & cache

**Goal**: efficient, resumable stem downloads with a pluggable cache.

- [ ] `StemCache` interface: `has(hash)`, `get(hash)`, `put(hash, bytes)`, `evict(...)`.
- [ ] In-memory impl in SDK.
- [ ] Stem fetcher: concurrent download with backpressure, integrity check, stores via cache.
- [ ] Pre-fetch scheduler: given a list of riff IDs, warm the cache.
- [ ] LORE sqlite jam-archive importer — read an existing LORE archive and populate the cache + jam metadata, so LORE users can bring their data in without going through the network.

**Checkpoint**: app can request a riff and have all 8 stems on disk in under 2× the slowest stem's download time.

---

## Phase 5 — App shell & Tauri plumbing

**Goal**: the Vue app is properly wired to Tauri.

- [ ] Tauri commands: `fetchUrl` (CORS-free HTTP), `cacheRead`/`cacheWrite` (filesystem), `keychainGet`/`keychainSet` (secure token store).
- [ ] Inject Tauri-backed `fetch` and `TokenStore` into the SDK.
- [ ] Pinia store for session, current jam, current riff selection.
- [ ] Basic UI: login screen → jam list → riff list (no audio yet).

**Checkpoint**: log in, browse jams, browse riffs — all from the Tauri app.

---

## Phase 6 — Audio engine: playback & phase-locked hops

**Goal**: live performance mode works.

- [ ] Tone.js setup: master bus, per-stem channels (×8), crossfade pair for hop transitions.
- [ ] Stem loader: decode cached bytes → `AudioBuffer` (FLAC via libflac.js, Ogg via `decodeAudioData`).
- [ ] Playback engine: start riff at offset, loop at bar boundary.
- [ ] Hop: compute `elapsedInLoop`, start next riff phase-locked, crossfade over configurable ms (default ~250ms, snap-to-bar option).
- [ ] Pre-cache strategy: when user is viewing riff N, decode N and N±2 into AudioBuffers in the background.
- [ ] UI: a "perform" view — riff list, click to hop, current playhead indicator.

**Checkpoint**: user can play a jam by clicking through riffs, transitions are seamless and phase-locked.

---

## Phase 7 — Hop recording

**Goal**: capture performance as an editable sequence.

- [ ] Data model: `HopSequence = { hops: { tAbsolute, riffId, transitionMs }[], durationMs }`.
- [ ] Recorder: hooks into the playback engine, records each hop with `AudioContext.currentTime` precision.
- [ ] Persist sequences (Tauri filesystem, JSON, project-folder pattern).
- [ ] Playback of a recorded sequence (read-only first).

**Checkpoint**: record a session, save it, reopen and replay identically.

---

## Phase 8 — Timeline editor

**Goal**: the actual product — non-linear hop editing.

- [ ] Timeline component (consider `wavesurfer.js` for waveform display; build hop UI on top).
- [ ] Edit operations: drag hop to new time, change transition duration, delete hop, insert hop from riff browser.
- [ ] Live preview: edits play back instantly using the AudioBuffer cache.
- [ ] Undo/redo.

**Checkpoint**: a recorded session can be tightened, looped sections shortened, transitions tuned.

---

## Phase 9 — Export

**Goal**: render a sequence to disk.

- [ ] `OfflineAudioContext` render path matching the live engine exactly.
- [ ] Stereo WAV export (16/24-bit).
- [ ] Multitrack export: 8 stems × N riffs collapsed onto 8 output tracks at hop boundaries (FLAC, individual files).
- [ ] Project export: `.zip` with sequence JSON + referenced stems for portability.

**Checkpoint**: render is bit-identical to live playback for the same sequence. (Or close enough — document any drift.)

---

## Beyond v1 (don't build yet, just record ideas)

- Tag/search across jams (LORE-style data viz)
- BEAM-compatible WebSocket output (drive a separate live mixer)
- Bar-snapping editor mode
- Stem-level muting/soloing per-hop
- MIDI clock out for sync with external gear