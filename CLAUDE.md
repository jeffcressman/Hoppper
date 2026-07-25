# CLAUDE.md

Context for Claude Code working on this project. Read this first, then `MEMORY.md` for what past sessions learned, then `PLAN.md` for the current phase.

## What we're building

A desktop app (Tauri + Vue 3) that lets a user record and edit sequences of "rifff hops" against the Endlesss jamming platform. See `README.md` for the user-facing concept.

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
├── CLAUDE.md
└── MEMORY.md
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

**LORE must always be available.** It is the spec for everything we
re-implement. If `/refs/OUROVEON` is missing or empty and the task at hand
would benefit from reading it — anything touching the protocol, data shapes,
timing, or playback semantics — **stop and tell the user**, rather than
guessing or reasoning from our own docs alone. Say what you needed it for.
Check with `ls /refs/OUROVEON`, and never suppress the error (a bare
`2>/dev/null` on a path that turns out to be wrong reads exactly like a
missing mount — it isn't).

LORE is C++. We are not porting C++. We are re-implementing the *protocol layer*
in TypeScript using LORE as the spec. Areas of interest:

- `src/r3.endlesss/endlesss/` — auth, API endpoints, data types, riff/stem
  timing, WebSocket protocol. Most useful files: `api.h`, `core.types.h`,
  `live.riff.cpp` (riff timing and stem length reconciliation),
  `live.stem.cpp`, `cache.stems.cpp`, `toolkit.warehouse.cpp` (sqlite archive).
- `src/r2.ouro/` — shared app-level services.

LORE renames its directory prefixes as it grows (`r0.endlesss` became
`r3.endlesss`), so confirm the path with `ls /refs/OUROVEON/src` before
concluding something isn't there.

We **ignore BEAM-specific code** and we ignore the C++ audio engine (PortAudio, r8brain, FLAC mixing, ImGui). Web Audio + Tone.js replace all of that.

When you need to understand how Endlesss does something, read the relevant LORE source and document the finding in `docs/protocol/` as you go. Don't copy LORE code; re-express in idiomatic TypeScript.

## Key technical decisions (locked in)

- **Framework**: Vue 3 + Vite
- **Desktop shell**: Tauri 2.x (Rust backend). Reasons: CORS bypass, keychain, disk cache, small bundle.
- **Audio**: Web Audio API via Tone.js. AudioWorklet for any custom DSP. OfflineAudioContext for export rendering.
- **Codecs in browser**: `libflac.js` for lossless FLAC stems; native `decodeAudioData` for Ogg Vorbis.
- **Stem cache**: Tauri filesystem (real disk), keyed by stem hash. LRU eviction with size cap (user-configurable).
- **Auth storage**: Tauri stronghold or OS keychain via plugin. Never plaintext on disk.
- **Rifff hopping**: phase-locked. New rifff starts at `(now - prevStart) % prevLoopDuration`. Crossfade via two `GainNode`s.

## Conventions

- **Test-driven development.** Write a failing test first, then the minimum code to make it pass, then refactor. No production code lands without a test that demanded it. Exceptions: Phase 0 (reading/documenting LORE) and Phase 1 (tooling scaffold) — for these, tests arrive with the deliverable rather than before it. From Phase 2 onward, strict TDD.
- Functional code over classes where reasonable; classes fine for stateful audio nodes and the SDK client.
- All Endlesss endpoint calls go through one HTTP client in the SDK with retry/backoff (Endlesss servers are known-flaky).
- Every reverse-engineered endpoint gets a short note in `docs/protocol/<endpoint>.md`: URL, method, request shape, response shape, observed quirks, LORE source reference.
- No secrets in the repo. `.env.local` for dev only; gitignored.

## Working memory — `MEMORY.md`

`MEMORY.md` is the project's accumulated hard-won knowledge: platform
behaviours that surprised us, why a piece of code is shaped the way it is,
known gaps we chose to leave, environment quirks. It exists so a later
session doesn't pay again for something an earlier one already learned.

**Every session, both ends:**

- **At the start** — read it, right after this file. If it contradicts what
  you find in the code, the code wins; fix the entry.
- **Before you finish** — add what this session learned. Do this as part of
  wrapping up the work, not only when asked. If a session genuinely turned up
  nothing durable, say so and leave the file alone.

What belongs there:

- Behaviour of a dependency, browser API or Endlesss server that isn't in its
  documentation, or that contradicts the obvious reading of it.
- The reason behind a non-obvious design choice, where the code can only show
  the *what*.
- Known gaps, deferred decisions, and anything raised with the user and still
  awaiting an answer — with the date and what was asked.
- Debugging techniques and test seams that actually cracked a hard problem, so
  the next session reaches for them first.
- Dev-container and tooling quirks (broken commands, missing mounts, which
  typecheck CI actually runs).

What does **not** belong there:

- Anything git already records: what changed, when, by whom. Notes describe
  what is *true now*, not a changelog.
- Anything already in `CLAUDE.md`, `PLAN.md`, `README.md` or `docs/` — put
  protocol findings in `docs/protocol/`, phase design in `docs/phases/`, and
  link to them from `MEMORY.md` rather than restating.
- Secrets, credentials, or anything from `.env.local`.

Keep entries short and durable. Group under the existing headings, newest
first, and date anything time-sensitive absolutely (`2026-07-24`, never
"recently"). Correct or delete entries that turn out to be wrong — a stale
memory is worse than none.

## Spelling: "Riff" vs "Rifff"

Endlesss's own product and wire protocol spell it **Rifff** (three f's) — e.g. the API paths `/jam/{id}/rifffs`, `shared_rifff`, `rifff-feed/share`, the JSON field `rifffId`, and the CouchDB view `rifffLoopsByCreateTime`. LORE itself diverges from this: its C++ identifiers (types, classes, variables) consistently use **Riff** (one f), reserving the triple-f spelling only for literal strings that must match the wire protocol exactly.

We follow LORE's convention in code rather than Endlesss's, since this project mirrors LORE's structure and is built alongside it — consistency with LORE makes the code easier to read and cross-reference:

- **Code** (TypeScript identifiers: types, classes, functions, variables, file names) — use `Riff`/`riff`, matching LORE. Example: `RiffDocument`, `RiffCouchID`, `riff-timing.ts`, `computeRiffTiming`.
- **Literal wire-protocol strings** (URL paths, JSON field/key names) — use `rifff`, matching the real server. Example: `` `/jam/${jamId}/rifffs` ``, the JSON field `rifffId`. Never "fix" these back to single-f — that breaks at the wire level.
- **Anything a human reads — no exceptions — use `Rifff`/`rifff`, the real Endlesss spelling:**
  - **Documentation prose**: this file, `README.md`, `PLAN.md`, `docs/**/*.md` — anywhere we're describing Endlesss the product/concept rather than naming a specific code symbol.
  - **User-facing app text**: every string a user of the app actually sees or hears — button labels, headings, menu items, tooltips, error/status messages, empty states, dialogs, notifications, alt text. This holds *even when the copy sits right next to single-f code* — e.g. a button bound to `hopTo(riff)` still reads "Hop to rifff", a component named `RiffDocument`-something still renders a heading that says "Rifff", an error surfaced from a `RiffCouchID` lookup still says "Rifff not found". The code identifier's spelling never leaks into the rendered string.
  - When prose or UI copy needs to name a specific code identifier directly (e.g. in a dev-facing log line or a code comment), keep that identifier's actual spelling (`Riff`) even inside the sentence — the "human-reads-it" rule is about naming the *concept*, not quoting a symbol.

## Server etiquette (important)

Endlesss is run by a small team on infrastructure that has already gone dark once. **Treat their servers as a fragile shared resource.** Concretely:

- **Make the minimum calls required.** If we have the data on disk, we don't fetch it again. Ever. Rifff documents, stem documents, stem audio bytes — once retrieved, they're ours.
- **No speculative pre-fetching beyond a small look-ahead window.** Pre-cache N±2 rifffs around the user's current position, not the whole jam.
- **Never poll faster than LORE does.** The sentinel poll rate is 5 seconds; don't go below that.
- **Rifff/stem data is immutable.** A given `RiffCouchID` or `StemCouchID` always points to the same payload, so cache hits are safe forever.
- **Cache by ID, not by URL.** CDN URLs may change; the CouchID never does.
- **Tests don't hit live servers in CI.** The integration test in `packages/sdk/test/integration.test.ts` is gated on `.env.local` credentials and is opt-in for local runs only.

The cache will grow large — a heavy user with hundreds of jams can easily reach tens of gigabytes. **Storage-management UI is on the roadmap for post-v1**: an eviction policy, per-jam size accounting, a "clear cache" affordance. We do not need to build it yet, but don't make architectural choices that would block it later (e.g., always include enough metadata in the cache index to compute jam-level totals on demand).

## Important caveats

- **Endlesss was offline May 2024 – August 2025**, then reopened under new owner Hablab London Limited. LORE continues to function correctly against the current servers, so it remains a reliable reference.
- Servers can disappear again. Design the SDK so jam data already downloaded works fully offline. Support import of LORE's sqlite archive format so existing LORE users can bring their data in.

## Where to find the current task

`PLAN.md`. Phases are numbered; work through them in order unless told otherwise. Each phase ends with a checkpoint — pause and confirm with the user before starting the next.

When a phase's design is bigger than its `PLAN.md` entry — interfaces, file layouts, TDD order, deferred items — it gets its own design doc at `docs/phases/phase-N-<slug>.md`, and `PLAN.md` links to it. Read the design doc before starting work on a phase that has one.