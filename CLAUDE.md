# CLAUDE.md

Context for Claude Code working on this project. Read this first, then `PLAN.md` for the current phase.

## What we're building

A desktop app (Tauri + Vue 3) that lets a user record and edit sequences of "riff hops" against the Endlesss jamming platform. See `README.md` for the user-facing concept.

Two deliverables:

1. **`packages/sdk`** — `endlesss-sdk`, a standalone TypeScript package. Auth, REST client, WebSocket client, types, stem fetching/caching abstraction. Must be usable independently of the app.
2. **`packages/app`** — The Vue + Tauri editor on top of the SDK.

## Project layout

Monorepo, pnpm workspaces.

```
hoppper/
├── .devcontainer/
├── packages/
│   ├── sdk/        # @hoppper/sdk
│   └── app/        # Tauri + Vue 3 + Vite
├── PLAN.md
├── README.md
└── CLAUDE.md
```

Use TypeScript everywhere. Strict mode. `vitest` for tests.

**Note**: "Hoppper" with three p's is intentional, not a typo. Do not "correct" it anywhere.

## Dev container setup

This project runs inside a dev container. On the **host**, the layout is:

```
<parent>/
├── hoppper/           ← this repo; open in VS Code → Reopen in Container
│   └── .devcontainer/
└── OUROVEON/          ← LORE reference, separate clone on the host, not committed
```

OUROVEON is cloned on the host (not inside the container — the container's firewall may not allow github clones, and VS Code on the host needs to see the directory for the bind mount).

`.devcontainer/devcontainer.json` exposes OUROVEON read-only via an entry in its `mounts` array:

```jsonc
"source=${localWorkspaceFolder}/../OUROVEON,target=/refs/OUROVEON,type=bind,readonly,consistency=cached"
```

`${localWorkspaceFolder}` resolves on the host before mounting, so it picks up the sibling directory there.

Inside the container:

- This project: **`/workspace`** (the `workspaceFolder`)
- LORE: **`/refs/OUROVEON`** (read-only — never attempt to modify; the mount enforces it)

## Reference: OUROVEON / LORE

The protocol knowledge we need is at **`/refs/OUROVEON`** inside the container (read-only).

LORE is C++. We are not porting C++. We are re-implementing the *protocol layer* in TypeScript using LORE as the spec. Areas of interest:

- `src/r0.endlesss/` — auth, API endpoints, data types, WebSocket protocol
- `src/r2.ouro/` — jam syncing, stem cache, sqlite archive format

We **ignore BEAM-specific code** and we ignore the C++ audio engine (PortAudio, r8brain, FLAC mixing, ImGui). Web Audio + Tone.js replace all of that.

When you need to understand how Endlesss does something, read the relevant LORE source and document the finding in `docs/protocol/` as you go. Don't copy LORE code; re-express in idiomatic TypeScript.

## Key technical decisions (locked in)

- **Framework**: Vue 3 + Vite
- **Desktop shell**: Tauri 2.x (Rust backend). Reasons: CORS bypass, keychain, disk cache, small bundle.
- **Audio**: Web Audio API via Tone.js. AudioWorklet for any custom DSP. OfflineAudioContext for export rendering.
- **Codecs in browser**: `libflac.js` for lossless FLAC stems; native `decodeAudioData` for Ogg Vorbis.
- **Stem cache**: Tauri filesystem (real disk), keyed by stem hash. LRU eviction with size cap (user-configurable).
- **Auth storage**: Tauri stronghold or OS keychain via plugin. Never plaintext on disk.
- **Riff hopping**: phase-locked. New riff starts at `(now - prevRiffStart) % prevLoopDuration`. Crossfade via two `GainNode`s.

## Conventions

- **Test-driven development.** Write a failing test first, then the minimum code to make it pass, then refactor. No production code lands without a test that demanded it. Exceptions: Phase 0 (reading/documenting LORE) and Phase 1 (tooling scaffold) — for these, tests arrive with the deliverable rather than before it. From Phase 2 onward, strict TDD.
- Functional code over classes where reasonable; classes fine for stateful audio nodes and the SDK client.
- All Endlesss endpoint calls go through one HTTP client in the SDK with retry/backoff (Endlesss servers are known-flaky).
- Every reverse-engineered endpoint gets a short note in `docs/protocol/<endpoint>.md`: URL, method, request shape, response shape, observed quirks, LORE source reference.
- No secrets in the repo. `.env.local` for dev only; gitignored.

## Server etiquette (important)

Endlesss is run by a small team on infrastructure that has already gone dark once. **Treat their servers as a fragile shared resource.** Concretely:

- **Make the minimum calls required.** If we have the data on disk, we don't fetch it again. Ever. Riff documents, stem documents, stem audio bytes — once retrieved, they're ours.
- **No speculative pre-fetching beyond a small look-ahead window.** Pre-cache N±2 riffs around the user's current position, not the whole jam.
- **Never poll faster than LORE does.** The sentinel poll rate is 5 seconds; don't go below that.
- **Riff/stem data is immutable.** A given `RiffCouchID` or `StemCouchID` always points to the same payload, so cache hits are safe forever.
- **Cache by ID, not by URL.** CDN URLs may change; the CouchID never does.
- **Tests don't hit live servers in CI.** The integration test in `packages/sdk/test/integration.test.ts` is gated on `.env.local` credentials and is opt-in for local runs only.

The cache will grow large — a heavy user with hundreds of jams can easily reach tens of gigabytes. **Storage-management UI is on the roadmap for post-v1**: an eviction policy, per-jam size accounting, a "clear cache" affordance. We do not need to build it yet, but don't make architectural choices that would block it later (e.g., always include enough metadata in the cache index to compute jam-level totals on demand).

## Important caveats

- **Endlesss was offline May 2024 – August 2025**, then reopened under new owner Hablab London Limited. LORE continues to function correctly against the current servers, so it remains a reliable reference.
- Servers can disappear again. Design the SDK so jam data already downloaded works fully offline. Support import of LORE's sqlite archive format so existing LORE users can bring their data in.

## Where to find the current task

`PLAN.md`. Phases are numbered; work through them in order unless told otherwise. Each phase ends with a checkpoint — pause and confirm with the user before starting the next.