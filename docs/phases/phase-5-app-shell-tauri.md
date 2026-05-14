# Phase 5 — App shell & Tauri plumbing

Detailed design doc for Phase 5. `PLAN.md` carries the short checklist; this
file carries plugin choices, adapter shapes, UI structure, and TDD order.

## Background

Phase 4 finished the SDK's stem fetching + cache. Phase 5 puts that SDK
behind a real Tauri 2.x desktop app: CORS-free HTTP, filesystem-backed
stem cache, encrypted token storage, and a minimal navigation flow
(login → jam list → riff list). **No audio yet** — that's Phase 6.

## Strategy

- **CORS-free HTTP** via `tauri-plugin-http`'s JS `fetch`. It's a
  drop-in for the browser `fetch`, so we inject it straight into the
  SDK's existing `HttpTransportOptions.fetch` seam — no new Rust
  command needed.
- **Filesystem stem cache** via `tauri-plugin-fs`. A
  `TauriFsAdapter` wraps the JS plugin to satisfy the SDK's
  `FsAdapter` interface; a `FilesystemStemCache` is constructed
  against it with `<appLocalDataDir>/stems/v2` as root.
- **Encrypted token storage** via `tauri-plugin-stronghold`. A
  `StrongholdTokenStore` satisfies the SDK's `TokenStore` interface.
  Vault password is generated once and stored at
  `<appLocalDataDir>/vault.key` — this matches the "encrypted at rest;
  key alongside ciphertext" pattern, defensible for Phase 5. Replacing
  the key file with OS keychain is post-v1 hardening, noted below.
- **Routing** via Vue Router. Three routes: `/login`, `/jams`,
  `/jams/:jamId`. A navigation guard redirects to `/login` when there's
  no valid session.
- **State** via Pinia stores: `useSessionStore`, `useJamsStore`,
  `useCurrentJamStore`. The `EndlesssClient` instance lives in a
  module-level singleton that the stores import.

## Architectural decisions

- **One `EndlesssClient` per app.** Stores share it via a
  `src/client.ts` module that creates the client at import time with
  Tauri-backed `fetch` and `TokenStore` injected.
- **No CORS-free fetch fallback.** `tauri-plugin-http` is required; the
  app refuses to start (clear error) if it can't load. We don't try to
  fall back to browser fetch, because Endlesss servers reject it.
- **Stem cache wiring is plumbing-only in Phase 5.** A sanity Tauri
  command (`__stem_cache_self_test`) writes and reads back a known
  byte to confirm the adapter works inside Tauri's sandbox. The UI
  doesn't surface or exercise it yet — Phase 6 does.
- **Stronghold vault contains exactly one record: the AuthSession.**
  Single key `"session"`, value is the JSON-serialized session.
  Simple, future-proof for adding more secrets later.
- **Vault key file lives at `<appLocalDataDir>/vault.key`.** First run
  generates 32 random bytes (Web Crypto), writes the file with
  restrictive perms where possible, and uses those bytes as the
  Stronghold password.
- **No login retries beyond what the SDK already does.** The HTTP
  transport already retries 5xx/network. Auth-level errors surface
  directly in the UI (red banner under the form).
- **Component tests are minimal.** Adapters and stores have unit
  tests (vitest + happy-dom + mocked `@tauri-apps/api`). Components
  get smoke tests only (does it render?). Real interaction validation
  happens by running `pnpm dev` and clicking through.

## Tauri plugins to add

Rust (`packages/app/src-tauri/Cargo.toml`):

```toml
tauri-plugin-http       = "2"
tauri-plugin-fs         = "2"
tauri-plugin-stronghold = "2"
```

JS (`packages/app/package.json`):

```json
"@tauri-apps/plugin-http":       "^2.0.0",
"@tauri-apps/plugin-fs":         "^2.0.0",
"@tauri-apps/plugin-stronghold": "^2.0.0",
"vue-router":                    "^4.4.0"
```

Permissions / capabilities
(`packages/app/src-tauri/capabilities/default.json`):

- `http:default` with URL scope: `https://api.endlesss.fm/*`,
  `https://data.endlesss.fm/*`, `https://**.amazonaws.com/*` (CDN
  buckets — exact host range determined by inspecting a few resolved
  stem URLs against the live integration test).
- `fs:default` with path scope: `$APPLOCALDATA/**`.
- `stronghold:default` (no scope needed — single vault path).

## Interfaces

```ts
// packages/app/src/tauri/fs-adapter.ts
export function tauriFsAdapter(): FsAdapter;
```

Wraps `@tauri-apps/plugin-fs` methods (`readFile`, `writeFile`,
`rename`, `mkdir`, `readDir`, `stat`, `remove`) into the SDK's
`FsAdapter` shape. `stat` returns `null` on `NotFound` to match the
SDK contract.

```ts
// packages/app/src/tauri/token-store.ts
export interface StrongholdTokenStoreOptions {
  vaultPath: string;
  password: Uint8Array;
}
export class StrongholdTokenStore implements TokenStore {
  // save / load / clear, all hitting the single "session" record.
}
export async function openTokenStore(): Promise<StrongholdTokenStore>;
```

`openTokenStore` resolves `<appLocalDataDir>/vault.key` and
`<appLocalDataDir>/session.stronghold` paths, generating the key on
first run.

```ts
// packages/app/src/client.ts
export const client: EndlesssClient;
```

Lazy module-singleton. Construction is deferred until the first
component imports it (after `openTokenStore()` has resolved). Wraps:

- `fetch: fetchFromTauriPlugin`
- `tokenStore: await openTokenStore()`

```ts
// packages/app/src/stores/session.ts
export const useSessionStore = defineStore('session', () => {
  const session: Ref<AuthSession | null>;
  const isAuthenticated: ComputedRef<boolean>;
  async function login(username: string, password: string): Promise<void>;
  async function logout(): Promise<void>;
  async function hydrate(): Promise<void>;       // reads token store on app start
});

// packages/app/src/stores/jams.ts
export const useJamsStore = defineStore('jams', () => {
  const listing: Ref<JamListing | null>;
  const profilesById: Ref<Map<JamCouchID, JamProfile>>;
  async function refresh(): Promise<void>;
  async function loadProfile(jamId: JamCouchID): Promise<void>;
});

// packages/app/src/stores/current-jam.ts
export const useCurrentJamStore = defineStore('currentJam', () => {
  const jamId: Ref<JamCouchID | null>;
  const riffPage: Ref<RiffDocument[]>;
  async function open(jamId: JamCouchID): Promise<void>;
  async function loadNextPage(): Promise<void>;
  function close(): void;
});
```

## UI structure

```
src/
├── App.vue                    # <RouterView />, global error banner
├── main.ts                    # createApp + Pinia + router; hydrate session before mount
├── router.ts                  # Vue Router config + auth guard
├── client.ts                  # module-singleton EndlesssClient
├── stores/
│   ├── session.ts
│   ├── jams.ts
│   └── current-jam.ts
├── tauri/
│   ├── fs-adapter.ts
│   └── token-store.ts
└── views/
    ├── LoginView.vue          # form + AuthError banner
    ├── JamListView.vue        # personal + subscribed + joinable lists
    └── JamDetailView.vue      # profile header + paginated riff list
```

Looks
- Plain HTML + minimal CSS for Phase 5 — no design system yet.
- Riff list shows: `createdAt`, slot count (active/8), and the riff's
  short ID. Click a riff = no-op for now (placeholder for Phase 6).
- Pagination: a "Load more" button calls `loadNextPage()`. No
  infinite scroll yet.

## Implementation order (TDD)

Each cycle: failing test → implementation → commit. Component smoke
tests come *with* the component, not before.

1. **App-package test harness.** Add `vitest`, `happy-dom`,
   `@vue/test-utils`. Wire up `pnpm --filter @hoppper/app test`.
   First test: a trivial pass to verify the harness.
2. **`tauriFsAdapter`** with mocked `@tauri-apps/plugin-fs`. Tests:
   round-trip readFile/writeFile via mocked invoke; stat returns null
   on NotFound; mkdir recursive flag passed through.
3. **`StrongholdTokenStore`** with mocked
   `@tauri-apps/plugin-stronghold`. Tests: save serializes session
   JSON to the `"session"` record; load returns null on empty vault;
   clear removes the record.
4. **`openTokenStore` key-file flow**. Tests: generates a 32-byte key
   on first run; reuses an existing key on subsequent runs.
5. **`useSessionStore`** with a stub client. Tests: login populates
   `session`; logout clears it; hydrate reads the token store; auth
   errors surface as a string state. Use `setActivePinia(createPinia())`
   per test.
6. **`useJamsStore`** with a stub client. Tests: `refresh` populates
   listing; `loadProfile` caches in `profilesById`; second
   `loadProfile` of the same ID doesn't refetch.
7. **`useCurrentJamStore`** with a stub client. Tests: `open` calls
   `iterateRiffs` for the first page; `loadNextPage` appends; `close`
   resets.
8. **`router.ts`** auth guard. Test: unauthenticated → redirected to
   `/login`; authenticated → passes through.
9. **`LoginView`** — smoke render + form submission triggers
   `sessionStore.login`. Test uses mounted component with a stub
   store.
10. **`JamListView`** — smoke render of three sections.
11. **`JamDetailView`** — smoke render of profile + riff rows.
12. **Tauri sanity command** `__stem_cache_self_test`: Rust command
    that, given a write byte, writes and reads back via the
    FilesystemStemCache constructed against tauriFsAdapter. No JS
    test (integration-only); manually verified via dev console on
    first dev-server run.
13. **Wire `client.ts`** with real Tauri fetch + StrongholdTokenStore;
    run `pnpm dev`, exercise login → jam list → riff list, and
    confirm the checkpoint.

## Files

To create:

- `packages/app/vitest.config.ts`
- `packages/app/test/setup.ts`
- `packages/app/src/tauri/fs-adapter.ts`
- `packages/app/src/tauri/token-store.ts`
- `packages/app/src/client.ts`
- `packages/app/src/router.ts`
- `packages/app/src/stores/session.ts`
- `packages/app/src/stores/jams.ts`
- `packages/app/src/stores/current-jam.ts`
- `packages/app/src/views/LoginView.vue`
- `packages/app/src/views/JamListView.vue`
- `packages/app/src/views/JamDetailView.vue`
- `packages/app/test/**/*.test.ts` (one per module above)

To modify:

- `packages/app/package.json` — vitest, happy-dom, @vue/test-utils,
  vue-router, @tauri-apps/plugin-*.
- `packages/app/src-tauri/Cargo.toml` — three plugin deps.
- `packages/app/src-tauri/src/lib.rs` — `.plugin(...)` for http, fs,
  stronghold; add the `__stem_cache_self_test` command.
- `packages/app/src-tauri/capabilities/default.json` — URL + path
  scopes.
- `packages/app/src/App.vue` — replace placeholder with `<RouterView/>`
  + an error banner.
- `packages/app/src/main.ts` — install Pinia + router; hydrate
  session before mount.
- `PLAN.md` — tick boxes at end of phase.

## Verification

`pnpm --filter @hoppper/app test` (unit): all stores + adapters pass.

`pnpm dev` (manual): log in with `.env.local` creds; see jam list;
click a jam; see riffs. Restart the app, confirm session persists
(stronghold round-trip). Check that the cache directory and `vault.key`
both appear under `appLocalDataDir`. Open dev tools and call
`window.__hoppperSelfTest()` (a dev-only wrapper around the Rust
command) to verify the FsAdapter wiring writes + reads a byte.

## Deferred / explicitly NOT in Phase 5

- **Audio playback** → Phase 6.
- **Riff click behavior** → Phase 6 (will trigger stem prefetch +
  decode).
- **Riff cursor / N±2 lookahead scheduling** → Phase 6 / app layer.
- **OS-keychain-backed vault key** → post-v1 hardening. Document the
  current `vault.key` model in the README.
- **LORE warehouse.db3 metadata import** → not in any phase yet;
  added when we feel the need for jam-name lookup at the LORE-archive
  scale.
- **Design system / theming** → later.
- **i18n** → later.
- **Settings UI** (cache root, log-level, etc.) → later.
