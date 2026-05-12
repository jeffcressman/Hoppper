# Hoppper

A non-linear editor for Endlesss riff-hop sequences. Listen through a jam, record the timing of your riff hops, then go back and adjust the transitions on a timeline.

(Name is intentional — three p's. A nod to *hopping* between riffs.)

## Status

Early development. Not yet functional.

## Concept

In the Endlesss app, clicking through riff history creates an ad-hoc track: each new riff phase-locks to where the previous one was playing and crossfades in. This editor:

1. **Captures** the sequence and timing of those hops as you perform them
2. **Pre-caches** the involved riffs locally so editing has no network latency
3. **Lets you adjust** hop timing and transition length on a timeline
4. **Exports** the final sequence as a multitrack or stereo render

## Architecture

Two packages in one repo:

- **`packages/sdk`** — `endlesss-sdk`, a TypeScript client for Endlesss' (unofficial, reverse-engineered) HTTP/WebSocket API. Auth, jam/riff/stem fetching, data types. Reusable by other projects.
- **`packages/app`** — The editor itself. Vue 3 + Vite + Tauri. Web Audio (via Tone.js) for sample-accurate playback and OfflineAudioContext rendering.

Tauri handles what the browser can't: CORS-free HTTP to Endlesss servers, keychain storage for session tokens, persistent disk cache for stems.

## Credit & reference

This project is a TypeScript reimplementation of the protocol layer reverse-engineered by Harry Denholm (ishani) in [OUROVEON/LORE](https://github.com/OUROcorp/OUROVEON). LORE is the canonical reference for how to talk to Endlesss. No LORE code is vendored here; we read it, we don't copy it.

Not affiliated with or endorsed by Endlesss / Hablab London Limited.

## Local development

### Prerequisites

This project runs inside the provided dev container. Open the repo in VS Code and choose **Reopen in Container** when prompted (requires the Dev Containers extension). The container includes Node 20 and pnpm; the first rebuild after the Phase 1 scaffold will also install Rust and the Tauri Linux system libraries.

If you are not using the dev container, you need:
- Node 20+
- pnpm 9+ (`npm install -g pnpm`)
- Rust stable (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- Tauri system dependencies for your platform — see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

### Install dependencies

```sh
pnpm install
```

### Run the desktop app (Tauri window)

```sh
pnpm dev
```

This starts the Vite dev server for the Vue frontend and compiles the Tauri Rust backend, then opens the Hoppper desktop window. The first run takes longer while Cargo fetches and compiles crates; subsequent runs are fast.

### Run tests

```sh
pnpm test
```

Runs the SDK test suite with vitest.

### Build

```sh
pnpm build
```

Builds the SDK to `packages/sdk/dist/` and bundles the Tauri app.

### Lint

```sh
pnpm lint
```

### Typecheck only

```sh
pnpm --filter @hoppper/sdk exec tsc --noEmit
pnpm --filter @hoppper/app exec vue-tsc --noEmit
```

### OUROVEON / LORE reference

The LORE C++ source is mounted read-only inside the container at `/refs/OUROVEON`. On the host, clone it as a sibling to this repo:

```sh
git clone https://github.com/OUROcorp/OUROVEON ../OUROVEON
```

The dev container bind-mounts it automatically via `.devcontainer/devcontainer.json`.

## License

TBD.