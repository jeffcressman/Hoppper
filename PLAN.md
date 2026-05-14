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

- [x] `listJams()` — returns subscribed + personal + joinable jams as `JamRef`s. Names are NOT eagerly fetched (server-etiquette); caller uses `getJam` per ID.
- [x] `getJam(jamId)` — JamProfile (displayName, bio?, appVersion?). Hyphen→(2d) escape applied for personal jam IDs.
- [x] `getRiffIds(jamId, opts)` + `getRiffs(jamId, ids)` + `iterateRiffs(jamId, opts)` — paginated, async iterator handles 50k+ riff jams without loading all at once.
- [x] `resolveStemUrl(stemDoc)` (pure) + `getStemUrls(jamId, riff)` — handles quirks #1 (length-as-string), #4 (missing OGG key), #5 (http(s):// in endpoint), #6 (bucket-in-endpoint). Prefers FLAC when present.
- [x] Types split into `packages/sdk/src/types/` (auth, ids, jam, riff, stem).
- [x] Live integration test against a known small jam, gated behind `HOPPPER_RUN_LIVE_TESTS=1` to avoid hitting servers on routine `pnpm test`.

**Checkpoint**: ~~SDK can enumerate a jam and produce playable stem URLs.~~ ✓ Done 2026-05-12 — live test confirmed enumeration + stem URL resolution against `bande7b989f1bb` (jam 'lwlkc').

---

## Phase 4 — SDK: stem fetching & cache

**Goal**: efficient, resumable stem downloads with a pluggable cache, including a zero-duplication path for users with existing LORE archives.

Detailed design: [`docs/phases/phase-4-stems-and-cache.md`](docs/phases/phase-4-stems-and-cache.md).

- [x] `StemCache` interface (keyed by `StemCouchID`): `has`, `get`, `put`, optional `evict`.
- [x] `InMemoryStemCache` and `FilesystemStemCache` (V2 layout: `<root>/<jamId>/<firstChar>/<stemId>.<ext>`, atomic writes).
- [x] `FsAdapter` injection seam (default `node:fs/promises`; Tauri plugs in its own in Phase 5).
- [x] `HttpTransport.requestBinary()` — shares retry loop with the existing JSON path.
- [x] `StemFetcher`: bounded-concurrency download (default 4 in-flight), byte-length integrity check, `allowSizeMismatch` flag matching LORE's `hackAllowStemSizeMismatch`.
- [x] `prefetchRiffs(...)`: async-iterator progress handle with `cancel()` and `done()`.
- [x] **LORE piggyback (reframed from "importer")**: `ReadonlyLoreStemDir` is a first-class read-only cache tier, composed via `LayeredStemCache` with `promoteOnRead: true`. Stems live where LORE put them; touched stems get promoted into Hoppper's own cache so Hoppper becomes self-contained over time. **No byte duplication of untouched stems.** The sqlite `warehouse.db3` metadata importer is deferred to Phase 5 where the Tauri sqlite plugin lives.

**Checkpoint**: app can request a riff and have all 8 stems on disk in under 2× the slowest stem's download time. Live-test acceptance gate gated behind `HOPPPER_RUN_LIVE_TESTS=1`; optional LORE-archive smoke test gated behind `HOPPPER_LORE_STEM_V2_ROOT=...`.

---

## Phase 5 — App shell & Tauri plumbing

**Goal**: the Vue app is properly wired to Tauri.

Detailed design: [`docs/phases/phase-5-app-shell-tauri.md`](docs/phases/phase-5-app-shell-tauri.md).

- [x] Tauri-backed `fetch` (via `tauri-plugin-http`) injected into `HttpTransport`.
- [x] `TauriFsAdapter` (via `tauri-plugin-fs`) + sanity command `stem_cache_self_test` proving FilesystemStemCache works inside the sandbox.
- [x] `StrongholdTokenStore` (via `tauri-plugin-stronghold`) implementing the SDK's `TokenStore`; vault key file at `appLocalDataDir/vault.key`.
- [x] Pinia stores: `useSessionStore`, `useJamsStore`, `useCurrentJamStore`.
- [x] Vue Router with `/login`, `/jams`, `/jams/:jamId`; auth guard redirects to login.
- [x] Views: `LoginView`, `JamListView`, `JamDetailView` — no audio yet.

**Checkpoint**: log in, browse jams, browse riffs — all from the Tauri app.

---

## Phase 6 — Audio engine: playback & phase-locked hops

**Goal**: live performance mode works.

Detailed design: [`docs/phases/phase-6-audio-engine.md`](docs/phases/phase-6-audio-engine.md).

- [x] Per-riff voice graph: 8 BufferSources → shared GainNode → destination (`riff-voice.ts`). Tone.js deferred — raw Web Audio behind a thin AudioContextLike facade keeps the engine testable and avoids the dependency footprint. Master bus is just `context.destination` for now.
- [x] Stem loader: decode cached bytes → `AudioBuffer` via per-format dispatch (`decoder.ts` + `native-decoder.ts`). Both formats currently use `decodeAudioData`; libflac.js remains a deferred fallback if a webview lacks native FLAC.
- [x] Playback engine: cold-start path in `AudioEngine.hopTo` schedules every BufferSource with `start(now, 0)`, `loop = true`, `loopEnd = loopDurationSec`.
- [x] Hop: `computeHop` + engine wiring start the new riff `crossfadeSec` early so its playhead reaches `offsetInNew` at the phase-anchor moment; old voice fades 1→0 and new voice fades 0→1 over the same window. Snap-to-bar supported, off by default.
- [x] Pre-cache: `PrefetchRing.setWindow(jamId, [N-2..N+2])` walks each riff's stems through the StemLoader in series; window moves cancel further decodes.
- [x] UI: `PerformView.vue` with Hop button per riff, current-riff indicator, Stop button, busy badge on not-ready hops. Route `/jams/:jamId/perform`, linked from the jam detail header.

**Checkpoint**: user can play a jam by clicking through riffs, transitions are seamless and phase-locked. **Awaiting manual smoke** (TDD step 10 in the design doc) — the unit suite is green at 146 tests but the audible behavior can only be verified by a real listen-through. Run `pnpm dev`, log in, open a small jam → Perform, click a few riffs.

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