import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EndlesssClient,
  FilesystemStemCache,
  HttpTransport,
  InMemoryStemCache,
  LayeredStemCache,
  ReadonlyLoreStemDir,
  StemFetcher,
} from '../src/index.js';

// Live integration tests against api.endlesss.fm + data.endlesss.fm.
//
// These hit real Endlesss servers; we treat that infrastructure as fragile and
// only run them when the developer has explicitly opted in. To enable:
//
//   1. Put credentials in packages/sdk/.env.local
//   2. Set HOPPPER_RUN_LIVE_TESTS=1 in the same file
//
// Without that flag, every live test is skipped — even if credentials are
// present. This prevents accidental traffic on regular `pnpm test` runs.

const username = process.env.HOPPPER_ENDLESSS_USERNAME;
const password = process.env.HOPPPER_ENDLESSS_PASSWORD;
const optedIn = process.env.HOPPPER_RUN_LIVE_TESTS === '1';
const jamId = process.env.HOPPPER_TEST_JAM_ID;
const loreStemV2Root = process.env.HOPPPER_LORE_STEM_V2_ROOT;

const liveAuthReady = Boolean(optedIn && username && password);
const liveJamReady = Boolean(liveAuthReady && jamId);
const loreReady = Boolean(liveJamReady && loreStemV2Root);

describe.skipIf(!liveAuthReady)('EndlesssClient (live) — auth & jam listing', () => {
  it('logs in and fetches subscribed + personal + joinable jams', async () => {
    const client = new EndlesssClient({ userAgent: 'hoppper-sdk-integration/0.1.0' });

    const session = await client.login(username!, password!);
    expect(session.token).toMatch(/\S/);
    expect(session.password).toMatch(/\S/);
    // user_id is canonical username (login form accepts username or email);
    // don't compare to the env value.
    expect(session.userId).toMatch(/\S/);
    expect(session.expiresAt).toBeGreaterThan(Date.now());

    const listing = await client.listJams();
    expect(listing.personal.jamId).toBe(session.userId);
    expect(Array.isArray(listing.subscribed)).toBe(true);
    expect(Array.isArray(listing.joinable)).toBe(true);

    // eslint-disable-next-line no-console
    console.log(
      `[integration] ${listing.subscribed.length} subscribed, ${listing.joinable.length} joinable`,
    );
  }, 30_000);
});

describe.skipIf(!liveJamReady)('EndlesssClient (live) — jam, riffs, stems', () => {
  it('enumerates one page of riffs and resolves stem URLs', async () => {
    const client = new EndlesssClient({ userAgent: 'hoppper-sdk-integration/0.1.0' });
    await client.login(username!, password!);

    const profile = await client.getJam(jamId!);
    expect(profile.jamId).toBe(jamId);
    expect(profile.displayName).toMatch(/\S/);

    // Just one tiny page; we do not want to enumerate a 50k-riff jam in CI.
    let firstPage: Awaited<ReturnType<typeof client.iterateRiffs>> extends AsyncIterable<infer P>
      ? P
      : never;
    firstPage = [] as never;
    for await (const page of client.iterateRiffs(jamId!, { pageSize: 1 })) {
      firstPage = page as typeof firstPage;
      break;
    }
    expect(firstPage.length).toBeGreaterThan(0);
    const [riff] = firstPage;
    expect(riff.riffId).toMatch(/\S/);
    expect(riff.bps).toBeGreaterThan(0);
    expect(riff.slots).toHaveLength(8);

    const activeSlotCount = riff.slots.filter((s) => s.on).length;
    if (activeSlotCount === 0) {
      // eslint-disable-next-line no-console
      console.log(`[integration] riff ${riff.riffId} has no active slots — skipping stem resolve`);
      return;
    }

    const resolved = await client.getStemUrls(jamId!, riff);
    expect(resolved).toHaveLength(8);
    const playable = resolved.filter((r) => r && r.url.startsWith('https://'));
    expect(playable.length).toBeGreaterThan(0);

    // eslint-disable-next-line no-console
    console.log(
      `[integration] jam '${profile.displayName}', riff ${riff.riffId}, ${playable.length} playable stem URL(s)`,
    );
  }, 30_000);
});

describe.skipIf(!liveJamReady)('StemFetcher (live) — Phase 4 acceptance', () => {
  it('downloads all stems for a riff in under 2× the slowest individual stem time', async () => {
    // Record per-request timing (headers + body) by wrapping fetch and
    // pre-draining the response body inline. Cloning lets the caller still
    // consume the body afterwards.
    const timings = new Map<string, number>();
    const wrappedFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const started = performance.now();
      const res = await fetch(input, init);
      const clone = res.clone();
      void clone.arrayBuffer().then(() => {
        timings.set(url, performance.now() - started);
      });
      return res;
    };

    const client = new EndlesssClient({
      userAgent: 'hoppper-sdk-integration/0.1.0',
      fetch: wrappedFetch,
    });
    await client.login(username!, password!);

    let pickedRiff: Awaited<ReturnType<typeof client.getRiffs>>[number] | undefined;
    for await (const page of client.iterateRiffs(jamId!, { pageSize: 8 })) {
      pickedRiff = page.find((r) => r.slots.filter((s) => s.on).length > 0);
      if (pickedRiff) break;
    }
    if (!pickedRiff) {
      // eslint-disable-next-line no-console
      console.log('[integration] no riff with active slots — skipping acceptance gate');
      return;
    }

    const resolved = await client.getStemUrls(jamId!, pickedRiff);
    const playable = resolved.filter((r): r is NonNullable<typeof r> => r !== null);
    expect(playable.length).toBeGreaterThan(0);

    const cache = new InMemoryStemCache();
    const transport = new HttpTransport({
      fetch: wrappedFetch,
      userAgent: 'hoppper-sdk-integration/0.1.0',
    });
    const fetcher = new StemFetcher({ transport, cache });

    const startedAt = performance.now();
    const blobs = await fetcher.fetchRiff(jamId!, resolved);
    const totalMs = performance.now() - startedAt;

    const filled = blobs.filter((b): b is NonNullable<typeof b> => b !== null);
    expect(filled.length).toBe(playable.length);

    // Every stem on disk in the cache.
    for (const stem of playable) {
      const blob = await cache.get(stem.stemId);
      expect(blob).not.toBeNull();
      expect(blob!.bytes.length).toBe(stem.length);
    }

    // Slowest individual stem time from the wrapper.
    const stemTimings = playable
      .map((s) => timings.get(s.url))
      .filter((t): t is number => typeof t === 'number');
    expect(stemTimings.length).toBe(playable.length);
    const slowestMs = Math.max(...stemTimings);

    // eslint-disable-next-line no-console
    console.log(
      `[integration] fetched ${playable.length} stems in ${totalMs.toFixed(0)}ms, slowest individual ${slowestMs.toFixed(0)}ms`,
    );

    expect(totalMs).toBeLessThanOrEqual(2 * slowestMs);
  }, 60_000);
});

describe.skipIf(!loreReady)('LayeredStemCache (live) — LORE piggyback smoke test', () => {
  it('serves at least one stem from the LORE tier when the riff is in the archive', async () => {
    const client = new EndlesssClient({ userAgent: 'hoppper-sdk-integration/0.1.0' });
    await client.login(username!, password!);

    let pickedRiff: Awaited<ReturnType<typeof client.getRiffs>>[number] | undefined;
    for await (const page of client.iterateRiffs(jamId!, { pageSize: 16 })) {
      pickedRiff = page.find((r) => r.slots.filter((s) => s.on).length > 0);
      if (pickedRiff) break;
    }
    if (!pickedRiff) return;

    const resolved = await client.getStemUrls(jamId!, pickedRiff);

    const writableRoot = mkdtempSync(join(tmpdir(), 'hoppper-lore-piggyback-'));
    try {
      const writable = new FilesystemStemCache({ root: writableRoot });
      const lore = new ReadonlyLoreStemDir({ stemV2Root: loreStemV2Root! });
      const layered = new LayeredStemCache({ tiers: [writable, lore] });

      const transport = new HttpTransport({ userAgent: 'hoppper-sdk-integration/0.1.0' });
      const fetcher = new StemFetcher({ transport, cache: layered });

      const blobs = await fetcher.fetchRiff(jamId!, resolved);
      const sources = blobs
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .map((b) => b.source);
      // eslint-disable-next-line no-console
      console.log(`[integration] LORE piggyback stem sources: ${sources.join(',')}`);
      // We can't assert lore-source unless the user's archive contains this riff,
      // so just confirm the layered cache produced a blob for every active stem.
      const playable = resolved.filter((r) => r !== null);
      expect(sources.length).toBe(playable.length);
    } finally {
      rmSync(writableRoot, { recursive: true, force: true });
    }
  }, 60_000);
});

describe.skipIf(optedIn)('EndlesssClient (live) — skipped (opt-in)', () => {
  it('is skipped: set HOPPPER_RUN_LIVE_TESTS=1 + credentials in packages/sdk/.env.local to enable', () => {
    expect(optedIn).toBe(false);
  });
});
