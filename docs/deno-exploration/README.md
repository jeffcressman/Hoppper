# Deno Desktop exploration

Snapshot assessment of whether to migrate Hoppper from Tauri to Deno
Desktop. Written **July 2026** against **Deno 2.9.3** and the Deno
Desktop docs available at that time. Findings will age quickly — Deno
Desktop is post-2.9 preview-adjacent tooling and its docs are actively
being fleshed out.

## Why we looked

The appeal is real: one binary, one language toolchain, one config
file. Deno's all-in-one story — formatter, linter, test runner, task
runner, workspace manager, type checker, `deno compile`, and now
`deno desktop` — collapses the current Hoppper stack (pnpm + tsup +
vite + tauri + cargo + rustc) down to a single `deno` binary and a
`deno.json`. Fewer moving parts, faster onboarding, lower cognitive
load.

That's the pitch. The question was whether Hoppper's specific
constraints let us cash it in yet.

## What Deno Desktop is (as of 2026-07-19)

Sources:

- <https://docs.deno.com/runtime/reference/cli/desktop/>
- <https://deno.com>

Shape:

- `deno desktop` is a subcommand of the Deno CLI, introduced in Deno
  2.9. Not a separate tool.
- Compiles a Deno project into a self-contained desktop app. Output
  formats: `.app` / `.dmg` on macOS, `.msi` on Windows, `.AppImage` on
  Linux. `--all-targets` builds all three at once. `--target` picks a
  specific triple (docs example: `aarch64-apple-darwin`).
- Two rendering backends:
  - `webview` (default) — uses the system webview (WebKitGTK on Linux,
    WKWebView on macOS, WebView2 on Windows). Small binary.
  - `cef` — Chromium Embedded Framework. Full Chrome API surface,
    larger binary.
- CLI usage: `deno desktop main.ts`, `deno desktop --hmr main.ts`,
  `deno desktop --output MyApp.app main.ts`. Bare `deno desktop` in
  a project directory auto-detects a supported framework.
- Frameworks explicitly listed on the CLI reference page:
  **Next.js, Astro, Fresh, React Router**. Vue is not mentioned.
- Feature areas listed in the sidebar (details deferred to child
  pages we did not fetch): menus, tray and dock, dialogs,
  notifications, auto-update, hot module replacement, DevTools,
  error reporting.
- `deno.json` gains a `desktop` section for platform-specific output
  paths and a `release.baseUrl` for auto-update.

What the docs *don't* cover (as of this fetch):

- **IPC / native bindings**. No documented equivalent of Tauri's
  `#[tauri::command]`. The CLI reference mentions `Deno.BrowserWindow`
  but doesn't spell out the backend↔frontend surface.
- **Secure storage / keychain**. No Stronghold-equivalent documented.
- **Code signing / notarization**. Not on the CLI reference page.
- **Framework list is incomplete**. Vue's status is unclear — Deno
  has npm compatibility and reads pnpm lockfiles, so it *probably*
  works via `create-vue`, but "probably" is not what we want to
  build on.

## Hoppper-specific migration analysis

The Tauri surface we'd need to replace, ranked by risk.

### RED — could kill the migration on day one

**1. HTTP/1.1 pin against Endlesss's Cloudflare tier.**

Endlesss's `api.endlesss.fm` and `data.endlesss.fm` return HTTP 500
when contacted over HTTP/2 with reqwest's default fingerprint.
HTTP/1.1 succeeds. See [`endlesss-http1-cloudflare`
memory](../../memory-not-in-repo) for the full backstory. Hoppper's
current workaround: `packages/app/src-tauri/src/lib.rs` exposes an
`endlesss_http_fetch` Rust command that routes SDK calls through a
`reqwest::Client` configured for HTTP/1.1. See
`packages/app/src/tauri/endlesss-http-fetch.ts` for the JS side.

Deno's `fetch` is HTTP/2 by default. Whether it exposes a per-request
downgrade knob is undocumented at the pages we read. Fallback options:

- (a) Spawn a Rust sidecar from Deno. Defeats the "one binary" pitch.
- (b) Drop to `Deno.connectTls` + hand-written HTTP/1.1. Doable but
  nontrivial, and we'd own the HTTP client forever.
- (c) Wait for Deno to add an HTTP-version opt-in.

**Nothing else matters if we can't clear this.**

**2. `Cookie: LB=liveNN` load-balancer pinning header.**

Fetch spec forbids setting `Cookie` directly. Tauri's `plugin-http`
gets around it via the `unsafe-headers` feature (enabled in
`packages/app/src-tauri/Cargo.toml`). Deno's `fetch` follows the same
spec restriction; escape hatch unknown. Same fallback tree as #1.

### YELLOW — solvable but real work

**3. Stronghold vault for the session token.**

`packages/app/src/tauri/open-token-store.ts` wires
`tauri-plugin-stronghold` with a 32-byte libsodium password (hex-
encoded and decoded Rust-side). Deno has no first-party equivalent
we found in the docs. Replacements:

- OS keychain via a native module through Deno FFI. FFI is stable but
  a new muscle for this project.
- libsodium.js + a user-chosen passphrase. Bundle-size cost.
- Plaintext on disk with strict permissions. Weakest.

**4. `webview` backend + Web Audio + FLAC decode.**

The audio engine relies on Web Audio API and native
`decodeAudioData` for both Ogg Vorbis (`packages/app/src/audio/`)
and FLAC stems. Chromium (`cef` backend) has full support.
System webviews vary — native FLAC decoding via `decodeAudioData`
is spotty in some system webviews. If the default `webview` backend
can't decode FLAC on all three OSes, we either switch to `cef`
(larger binary, defeats some of the appeal) or bundle libflac.js as
a fallback everywhere (already planned as a fallback in the current
stack, so this is not a new burden — just a certain one).

**5. Vue 3 support.**

Not on the framework list, but npm compatibility strongly suggests
Vue works. Would need to verify in a spike.

### GREEN — clean swap

- **FS adapter** (`packages/app/src/tauri/fs-adapter.ts`) is a thin
  wrapper around `mkdir` / `readFile` / `writeFile` / `rename` /
  `readdir` / `stat` / `remove`. Deno's `Deno.mkdir`,
  `Deno.readFile`, etc., are a one-for-one. The `ENOENT` bridging
  stays inside the adapter; Deno throws `Deno.errors.NotFound`,
  easy to translate.
- **Vite build** should work under Deno (npm-compat + vite-plugin-
  vue). Config changes to `deno.json` in place of `package.json`
  scripts.
- **Everything above the adapters** — Pinia stores, Vue Router, audio
  engine (`packages/app/src/audio/`), hop recorder
  (`packages/app/src/hop-recorder/`), SDK client (`packages/sdk/`)
  — untouched. Zero changes.

## Recommendation

**Don't migrate now.** The Tauri stack works, Phase 6/7 audio +
recording are green, and the RED items above each carry weeks of
risk with unclear payoff.

Revisit when **at least two of these are true**:

1. Deno Desktop's docs cover IPC / native bindings / secure storage
   explicitly, with worked examples.
2. Vue appears on the officially supported frameworks list.
3. Either Deno's `fetch` grows an HTTP-version knob, OR someone else
   has proven `Deno.connectTls` can substitute cleanly for the
   HTTP/1.1 workaround (e.g., a community HTTP-client library).
4. A secure-storage story lands that isn't "roll your own keychain
   through FFI."

The all-in-one tooling pitch is genuinely appealing. Not yet
appealing enough to justify the transition cost given Hoppper's
specific server-etiquette and stem-decode constraints.

## Deferred: spike plan

If you ever have a spare day and want to actually test the RED
items, here's the playbook. Kept out of `PLAN.md` because it's not
a phase — it's contingency.

- Branch: `spike/deno-desktop` off `main`.
- New directory: `spike/deno-app/` (outside the pnpm workspace).
  Add to root `.gitignore` so pnpm ignores it.
- Reuse `packages/sdk/.env.local` for real credentials.

Four tests, in order:

1. **`deno desktop` launches a blank Vue window.** Verifies Vue is
   viable under Deno Desktop at all.
2. **Non-Endlesss `fetch()`.** Baseline — Deno's fetch works from
   the app.
3. **Endlesss auth `fetch()` with `Cookie: LB=liveNN` and HTTP/1.1.**
   The RED test. Success = 200 with a session token. If plain
   `fetch()` fails, try Deno's HTTP-client options; if those fail,
   attempt `Deno.connectTls` + hand-written HTTP/1.1. Time-box: half
   a day.
4. **FLAC decode via `decodeAudioData`.** Load one FLAC through
   `fetch` (already known to work from step 3) and confirm the
   default `webview` backend plays it. Fallback: `cef` backend or
   libflac.js.

Exit criteria:

- ✅ Pass: all four succeed. Write a real migration plan.
- ⚠️ Inconclusive: HTTP/1.1 works but only via raw sockets. Discuss
  whether the win justifies owning an HTTP client.
- ❌ Fail: Cloudflare can't be cleared. Stay on Tauri.

## Cross-references

- Current Tauri backend: `packages/app/src-tauri/`
- Current Tauri JS bindings: `packages/app/src/tauri/`
- SDK client (unchanged in any migration): `packages/sdk/src/client.ts`
- Related memory (in `~/.claude/projects/-workspace/memory/`):
  - `endlesss-http1-cloudflare.md` — why HTTP/1.1 pinning exists
  - `tauri-pitfalls.md` — the accumulated hard-won knowledge that
    would need re-earning on any new stack
  - `tauri-audio-devcontainer.md` — dev-container audio silence
    (same rule would apply to Deno Desktop: host-only for smoke)
  - `endlesss-hablab-stem-storage.md` — DigitalOcean Spaces allowlist
