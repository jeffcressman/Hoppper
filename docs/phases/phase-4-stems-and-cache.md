# Phase 4 — Stem fetching & cache (with LORE piggyback)

Detailed design doc for Phase 4. `PLAN.md` carries the short checklist; this
file carries the why, the shape of each module, and the implementation order.

## Background

The original Phase 4 line item was "LORE sqlite jam-archive importer." That
framing duplicates LORE's data into Hoppper's own cache, which contradicts the
server-etiquette principle in `CLAUDE.md` for users with multi-GB LORE archives.

Investigation of LORE's storage (see `docs/protocol/overview.md` for the
on-the-wire side; the on-disk side is summarised below):

- **Stems** live at `<storageRoot>/cache/common/stem_v2/<jamCouchID>/<firstChar>/<stemCouchID>.<ext>`.
  Files are **immutable** once downloaded. No sidecar metadata.
- **Metadata** is in `warehouse.db3` — sqlite, five tables (Jams, Riffs, Stems,
  Tags, StemLedger). Not in WAL mode, so concurrent reads block during writes.
- LORE doesn't store stem paths or hashes in sqlite; paths are derived from the
  V2 layout convention. `FileLength` is stored.

## Strategy

**Hybrid**: live-read LORE stem bytes in place; defer the sqlite metadata
importer to Phase 5 where Tauri's sqlite plugin lives.

**Promote-on-read = ON**: when a stem comes from LORE's read-only tier, copy it
into Hoppper's writable cache so Hoppper becomes self-contained over time and
survives LORE archive deletion. This costs some disk duplication for stems
Hoppper actually touches, but it's bounded by the user's listening, not by the
full LORE archive size.

**Prefetch progress** is an async iterator with `cancel()` and `done()` on the
handle.

The Phase 4 acceptance gate from `PLAN.md` remains: an app can request a riff
and have all 8 stems on disk in under 2× the slowest stem's download time.

## Architectural decisions

- **Stems are keyed by `StemCouchID` alone.** They're content-addressed; jamId
  is a *placement hint* for writes (mirrors LORE's V2 layout), not part of
  identity. A stem shared across jams resolves to the same bytes.
- **Layered cache** composes a single writable primary with N read-only fallback
  tiers. `ReadonlyLoreStemDir` is a first-class tier, not a one-time import.
- **Stem fetcher reuses `HttpTransport`** for retry/log uniformity. The retry
  loop is refactored into a private `attempt()` helper so JSON and binary code
  paths share it; a new `requestBinary()` method returns `Uint8Array`.
- **Backpressure** = bounded in-flight count via a semaphore. Default
  concurrency 4. A riff is 8 stems, so 4 keeps two waves and never starves a
  single riff.
- **Filesystem access via an `FsAdapter` interface**, default
  `node:fs/promises`. Tauri injects a different adapter in Phase 5. Mirrors the
  existing `fetch` and `TokenStore` injection pattern.
- **SDK ships no sqlite dependency this phase.** Metadata import is Phase 5.

## Interfaces

```ts
// packages/sdk/src/stems/cache.ts
export interface StemBlob {
  bytes: Uint8Array;
  format: StemFormat;            // 'ogg' | 'flac'
  length: number;
  source: 'memory' | 'fs' | 'lore' | 'network';
}

export interface StemCachePutKey {
  stemId: StemCouchID;
  jamId: JamCouchID;             // placement hint for V2 layout writes
  format: StemFormat;
}

export interface StemCache {
  readonly writable: boolean;
  has(stemId: StemCouchID): Promise<boolean>;
  get(stemId: StemCouchID): Promise<StemBlob | null>;
  put(key: StemCachePutKey, bytes: Uint8Array): Promise<void>;
  evict?(stemId: StemCouchID): Promise<void>;
}

// packages/sdk/src/stems/fs-adapter.ts
export interface FsAdapter {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string, opts: { recursive: boolean }): Promise<void>;
  stat(path: string): Promise<{ size: number } | null>;
}
```

Concrete impls:

- **`InMemoryStemCache`** — `Map<StemCouchID, StemBlob>`. `writable = true`.
- **`FilesystemStemCache`** — `{ root: string; fs?: FsAdapter }`. Writes to
  `<root>/<jamId>/<firstChar>/<stemId>.<ext>` atomically (`*.tmp` + rename).
  `writable = true`.
- **`ReadonlyLoreStemDir`** — `{ stemV2Root: string; fs?: FsAdapter }`. Reads
  `<stemV2Root>/<jamId>/<firstChar>/<stemId>.<ext>` (tries both `.flac` and
  `.ogg`). `put()` throws `ReadonlyCacheError`. `writable = false`. Because
  `jamId` is unknown from a `stemId` alone at read time, the reader builds an
  in-memory index of `stemId -> path` lazily on first miss; rebuild cost is a
  one-time directory scan per session.
- **`LayeredStemCache`** — `{ tiers: StemCache[]; promoteOnRead?: boolean }`,
  default `promoteOnRead = true`. Lookup walks tiers in order, first hit wins.
  When the hit tier is not the first writable tier and `promoteOnRead`, copy
  bytes into the first writable tier in the background (don't block the
  caller). `put()` goes to first writable tier only.

```ts
// packages/sdk/src/stems/fetcher.ts
export interface StemFetcherOptions {
  transport: HttpTransport;
  cache: StemCache;
  concurrency?: number;            // default 4
  allowSizeMismatch?: boolean;     // mirrors LORE hackAllowStemSizeMismatch
  logger?: (e: FetchLog) => void;
}

export class StemIntegrityError extends Error { /* size mismatch */ }

export class StemFetcher {
  fetchOne(resolved: ResolvedStem, jamId: JamCouchID): Promise<StemBlob>;
  fetchRiff(
    jamId: JamCouchID,
    resolved: (ResolvedStem | null)[],
  ): Promise<(StemBlob | null)[]>;
}
```

Per-stem flow: `cache.get` → hit returns blob; miss →
`transport.requestBinary` → integrity check (length match, warn-only if
`allowSizeMismatch`) → `cache.put` → return blob.

```ts
// packages/sdk/src/stems/prefetcher.ts
export interface PrefetchProgress {
  riffId: RiffCouchID;
  done: number; total: number;       // stems within this riff
  cached: number; downloaded: number; failed: number;
}

export interface PrefetchResult {
  riffsCompleted: number; riffsFailed: number; cancelled: boolean;
}

export interface PrefetchHandle {
  readonly progress: AsyncIterable<PrefetchProgress>;
  cancel(): void;
  done(): Promise<PrefetchResult>;
}

export function prefetchRiffs(args: {
  client: EndlesssClient;
  fetcher: StemFetcher;
  jamId: JamCouchID;
  riffIds: RiffCouchID[];
  windowSize?: number;               // honors "N±2 lookahead" from CLAUDE.md
}): PrefetchHandle;
```

Transport extension (`packages/sdk/src/transport.ts`):

```ts
HttpTransport.requestBinary(req: BinaryTransportRequest): Promise<Uint8Array>;
```

The existing retry/backoff loop in `request()` becomes a private `attempt()`
returning `Response`; both `request<T>` and `requestBinary` consume it.

## Implementation order (TDD)

Every cycle: failing test first → implementation → green → commit.

1. Refactor `HttpTransport` to share retry loop between `request<T>` and a new
   `requestBinary()`. Add tests for binary success, 4xx no-retry, 5xx retry,
   network retry. Existing JSON tests stay green.
2. `StemCache` interface + types (no behavior).
3. `InMemoryStemCache` + tests.
4. `StemFetcher.fetchOne` against `InMemoryStemCache` with a stubbed transport.
   Tests: hit returns cached; miss downloads + stores; integrity-pass and -fail
   paths; `allowSizeMismatch` flag behavior.
5. `StemFetcher.fetchRiff` with concurrency limiter. Test: 8 stems,
   concurrency=4, max-in-flight observed via a counter in the stub fetch never
   exceeds 4.
6. `FsAdapter` interface + default `node:fs/promises` impl.
7. `FilesystemStemCache` + tests using `os.tmpdir()` cleanup. Cover V2 layout,
   atomic write, has/get/put round-trip, both extensions.
8. `ReadonlyLoreStemDir` + tests using a fixture directory at
   `packages/sdk/test/fixtures/lore-stem-v2/`. Cover read-only enforcement,
   both extensions, miss returns `null`, lazy index.
9. `LayeredStemCache` + tests: tier order, writable selection, promote-on-read
   behavior (verify the background promote happens), miss across all tiers.
10. `prefetchRiffs` + tests: stubbed client + cache, async-iterator progress
    events, cancel mid-flight, partial failure.
11. Wire up exports in `packages/sdk/src/index.ts`.

## Files

To create:

- `packages/sdk/src/stems/cache.ts`
- `packages/sdk/src/stems/fs-adapter.ts`
- `packages/sdk/src/stems/in-memory-cache.ts`
- `packages/sdk/src/stems/fs-cache.ts`
- `packages/sdk/src/stems/lore-readonly.ts`
- `packages/sdk/src/stems/layered-cache.ts`
- `packages/sdk/src/stems/fetcher.ts`
- `packages/sdk/src/stems/prefetcher.ts`
- `packages/sdk/test/stems/*.test.ts` (one per module)
- `packages/sdk/test/fixtures/lore-stem-v2/...` (small valid Ogg/FLAC for tests)

To modify:

- `packages/sdk/src/transport.ts` — refactor retry loop, add `requestBinary()`.
  Reuse existing `HttpError`, `NetworkError`, `LogEntry`.
- `packages/sdk/src/index.ts` — re-export the new public surface.
- `PLAN.md` — tick boxes at end of phase.

Existing utilities to reuse:

- `HttpTransport` retry/backoff/logging in `src/transport.ts`
- `ResolvedStem` from `src/types/stem.ts`
- `JamCouchID`, `StemCouchID`, `StemFormat` from `src/types/`

## Verification

`pnpm test` (unit, no network): existing 82 + roughly 40 new tests pass.

Integration acceptance gate (opt-in via `HOPPPER_RUN_LIVE_TESTS=1`):

```
HOPPPER_RUN_LIVE_TESTS=1 pnpm --filter @hoppper/sdk test integration
```

Log expects: "fetched 8 stems in <X>ms, slowest individual <Y>ms"; assertion is
`X ≤ 2Y`. Bytes match `ResolvedStem.length`.

Optional LORE-archive verification:

```
HOPPPER_LORE_STEM_V2_ROOT=/path/to/lore/cache/common/stem_v2 \
HOPPPER_RUN_LIVE_TESTS=1 pnpm --filter @hoppper/sdk test integration
```

Expect cache hits from the `lore` tier; no network fetch for stems LORE
already has.

## Deferred / explicitly NOT in Phase 4

- LORE `warehouse.db3` sqlite reader → Phase 5 (Tauri sqlite plugin).
- Eviction / LRU / per-jam size accounting UI → post-v1 per `CLAUDE.md`.
- Tauri `FsAdapter` injection (filesystem via Tauri commands) → Phase 5.
- AudioBuffer decoding → Phase 6.
- Riff-cursor-aware speculative pre-fetch scheduler (the *consumer* of
  `prefetchRiffs`) → Phase 6 / app layer.
- Magic-byte format sniffing — left to the decoder; integrity check is
  byte-length only.
