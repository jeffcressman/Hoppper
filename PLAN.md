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
  - Core data shapes: `Jam`, `Riff`, `Stem`, `Shared Riff` (code type names, matching LORE)
  - WebSocket protocol (the one BEAM/LORE use for pushing rifff sequences)
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

## Phase 3 — SDK: jam & rifff data

**Goal**: list jams, get rifffs, get stem URLs.

- [x] `listJams()` — returns subscribed + personal + joinable jams as `JamRef`s. Names are NOT eagerly fetched (server-etiquette); caller uses `getJam` per ID.
- [x] `getJam(jamId)` — JamProfile (displayName, bio?, appVersion?). Hyphen→(2d) escape applied for personal jam IDs.
- [x] `getRiffIds(jamId, opts)` + `getRiffs(jamId, ids)` + `iterateRiffs(jamId, opts)` — paginated, async iterator handles 50k+ rifff jams without loading all at once.
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

**Checkpoint**: app can request a rifff and have all 8 stems on disk in under 2× the slowest stem's download time. Live-test acceptance gate gated behind `HOPPPER_RUN_LIVE_TESTS=1`; optional LORE-archive smoke test gated behind `HOPPPER_LORE_STEM_V2_ROOT=...`.

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

**Checkpoint**: log in, browse jams, browse rifffs — all from the Tauri app.

---

## Phase 6 — Audio engine: playback & phase-locked hops

**Goal**: live performance mode works.

Detailed design: [`docs/phases/phase-6-audio-engine.md`](docs/phases/phase-6-audio-engine.md).

- [x] Per-rifff voice graph: 8 BufferSources → shared GainNode → destination (`riff-voice.ts`). Tone.js deferred — raw Web Audio behind a thin AudioContextLike facade keeps the engine testable and avoids the dependency footprint. Master bus is just `context.destination` for now.
- [x] Stem loader: decode cached bytes → `AudioBuffer` via per-format dispatch (`decoder.ts` + `native-decoder.ts`). Both formats currently use `decodeAudioData`; libflac.js remains a deferred fallback if a webview lacks native FLAC.
- [x] Playback engine: cold-start path in `AudioEngine.hopTo` schedules every BufferSource with `start(now, 0)`, `loop = true`, `loopEnd = loopDurationSec`.
- [x] Hop: `computeHop` + engine wiring start the new rifff `crossfadeSec` early so its playhead reaches `offsetInNew` at the phase-anchor moment; old voice fades 1→0 and new voice fades 0→1 over the same window. Snap-to-bar supported, off by default.
- [x] Pre-cache: `PrefetchRing.setWindow(jamId, [N-2..N+2])` walks each rifff's stems through the StemLoader in series; window moves cancel further decodes. *Built and tested, but not yet called from the Perform view. Wiring it up moved to Phase 9.*
- [x] UI: `PerformView.vue` with Hop button per rifff, current-rifff indicator, Stop button, busy badge on not-ready hops. Route `/jams/:jamId/perform`, linked from the jam detail header.

**Checkpoint**: ~~user can play a jam by clicking through rifffs, transitions are seamless and phase-locked.~~ ✓ Done 2026-09-17 — listening tests passed in the Tauri app: phase-locked hops, hops on the beat, quantised entry (`SMOKE_TESTS.md`).

---

## Phase 7 — Hop recording

**Goal**: capture performance as an editable sequence.

Detailed design: [`docs/phases/phase-7-hop-recording.md`](docs/phases/phase-7-hop-recording.md).

- [x] Data model: `HopSequence = { schemaVersion, id, title, jamId, recordedAt, durationSec, hops: HopEvent[] }`.
- [x] Recorder: hooks into the click handler (performance store), records every click with `AudioContext.currentTime` precision — including not-ready clicks (user's timing is the artifact).
- [x] Persist sequences at `appLocalDataDir/sequences/<jamId>/<id>.json` (atomic write, FsAdapter for testability).
- [x] Playback of a recorded sequence (read-only first) via `HopPlayer` driving the existing `AudioEngine`.

**Checkpoint**: ~~code complete + tested at 217 unit tests; manual smoke confirmed live 2026-05-15.~~ ✓ Done — recording, save, list, replay, delete all working against live Endlesss jams.

**Checkpoint**: record a session, save it, reopen and replay identically.

---

## Phase 8 — Timeline editor

**Goal**: the actual product — non-linear hop editing.

Ships inside a whole-app redesign on the LwlkcIng design system, in three slices (A: shell and lists, B: Hop Recording, C: Hop Editing). Detailed design: [`docs/phases/phase-8-redesign-and-editor.md`](docs/phases/phase-8-redesign-and-editor.md).

- [x] Slice A — app shell, Public Jams, My Jams, Hops, Settings, login dialog. ✓ Checkpoint A passed 2026-09-18 (`SMOKE_TESTS.md`).
- [x] Slice B — Hop Recording: rifff splats, mixer (with the rifff's own slot gains now applied), waveform, top-bar transport and level meter. ✓ Checkpoint B passed 2026-09-18 (`SMOKE_TESTS.md`).
- [ ] Slice C — Hop Editing, to the spec signed off 2026-09-18 in the design doc:
- [x] Timeline component: stacked tracks per rifff, split lanes around a selected hop point, drawn phase-true from cached buffers (our own SVG, like the Hop Recording waveform, rather than `wavesurfer.js`). *(2026-09-18)*
- [x] Edit operations: drag a hop point (beat snap), delete a hop point, expand/add skipped rifffs, duplicate a rifff. *(2026-09-18. Changing transition duration: deferred by the user.)*
- [x] Live preview: edits play back instantly using the AudioBuffer cache. *(Play in the editor replays the edited take.)*
- [x] Undo/redo. *(Buttons and Ctrl/Cmd+Z, per editing session.)*
- [x] Automation: mixer fader, mute and solo recorded into takes, played back in replay, the editor and exports, and edited as lines in the editor. *(2026-09-18; design in the Phase 8 doc → "Automation".)*
- [x] A level meter beside each mixer fader. *(2026-09-18)*

**Checkpoint**: a recorded session can be tightened, looped sections shortened, transitions tuned.

---

## Phase 9 — Caching, pre-loading & efficiency

**Goal**: a clicked rifff almost never has to wait to load, and we never fetch the same data twice.

Moved out of Phases 6–8 on 2026-09-17 so the timeline editor and UI overhaul come first. Why it matters: a take is what the performer heard (see `docs/phases/phase-7-hop-recording.md` → "Principle"), so any wait for a load puts the take out of step with what the performer meant, and the editor then has to fix it. Pre-loading is what makes that rare.

- [ ] **Live pre-loading.** Start pre-loading once the first rifff is selected. Decide which rifffs (list neighbours of the last click, or something that tracks where the user is looking, since hops go anywhere in the list), how many, and when the window moves. `PrefetchRing` and `performance.prefetchWindow` already exist, tested but never called. Server etiquette caps speculative fetching at N±2.
- [ ] **Stem-file tier.** The SDK's `prefetchRiffs` (Phase 4) keeps stem files on disk ahead of decoding. It's not used by the app either; decide whether live pre-loading needs it or the decode ring is enough.
- [ ] **Stop re-fetching immutable data.** *(Done in memory 2026-09-18: `stores/stem-docs.ts` and `stores/riff-docs.ts` keep stem and rifff documents by ID, and hops and replay go through them. Still to do: keep them on disk.)* Every Hop click used to ask the server for the rifff's stem documents again (`getStemUrls` → `getStemDocuments`), even for a rifff already played. Replay's `resolveRiff` also re-fetches the rifff document for every hop. Rifff and stem documents never change, so cache them by ID, on disk, which also helps offline use.
- [ ] **Memory budget for decoded audio.** The in-memory `AudioBufferCache` holds 256 MB (LRU), and one rifff of eight 16-second stems takes about 50 MB decoded, so a five-rifff window could evict what was just played. Size the window and the cap together.
- [ ] **Measure it.** Log or show load time per click, so we can tell whether pre-loading is working in real use.

**Checkpoint**: in a normal performance, a click on a rifff near the current one plays without a visible load, and a rifff played once is never requested from the server again.

---

## Phase 10 — Export

**Goal**: render a sequence to disk.

- [x] `OfflineAudioContext` render path matching the live engine exactly. *(2026-09-18: `src/export/render.ts` renders through `createAudioEngine` itself, each hop scheduled at its time via `HopOptions.atSec`.)*
- [x] Stereo WAV export (16/24-bit). *(2026-09-18: 24-bit, from an Export button per take on the Hops page, via the system Save dialog.)*
- [ ] Multitrack export: 8 stems × N rifffs collapsed onto 8 output tracks at hop boundaries (FLAC, individual files).
- [ ] Project export: `.zip` with sequence JSON + referenced stems for portability.

**Checkpoint**: render is bit-identical to live playback for the same sequence. (Or close enough — document any drift.)

---

## Beyond v1 (don't build yet, just record ideas)

- Tag/search across jams (LORE-style data viz)
- BEAM-compatible WebSocket output (drive a separate live mixer)
- Bar-snapping editor mode
- Stem-level muting/soloing per-hop
- MIDI clock out for sync with external gear