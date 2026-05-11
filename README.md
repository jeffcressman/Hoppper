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

(To be filled in once scaffolded.)

## License

TBD.