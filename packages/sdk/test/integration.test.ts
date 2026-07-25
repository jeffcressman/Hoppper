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
// Not part of the public surface: the probe resolves URLs from stem documents
// it already has, to avoid repeating getStemUrls' identical _all_docs POST.
import { resolveStemUrl } from '../src/parse.js';
import { readAudioHeader } from './helpers/audio-header.js';

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

// The stem timing probe downloads every stem of each riff it inspects, so it
// looks at one riff unless asked otherwise. Capped: this is a diagnostic, not
// a reason to pull a jam down.
const probeRiffCount = Math.min(
  4,
  Math.max(1, Number(process.env.HOPPPER_PROBE_RIFF_COUNT ?? '1') || 1),
);

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
      expect(blob!.bytes.length).toBe(stem.byteLength);
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

describe.skipIf(!liveJamReady)('Stem timing probe (live) — declared metadata vs encoded audio', () => {
  // Does a stem's document tell the truth about its audio?
  //
  // Two claims the app relies on and cannot currently check, because
  // `ResolvedStem` drops the fields that carry them:
  //
  //   1. `sampleRate` matches the rate the audio is actually encoded at.
  //      `decodeAudioData` resamples from the *file's* rate to the
  //      AudioContext rate, so if the document's rate is the real intent (as
  //      docs/protocol/overview.md:537 says LORE assumes) every such stem
  //      plays at the wrong speed and drifts.
  //   2. `length16ths` / `bps` describe the stem's real length, i.e.
  //      `(length16ths / 4) / bps` seconds of audio. The audio engine
  //      currently infers loop length from the decoded buffer instead.
  //
  // Diverging numbers here are the finding — the failure message is the
  // report. One `_all_docs` POST per riff: we call getStemDocuments directly
  // and resolve URLs from those same documents rather than also calling
  // getStemUrls, which would repeat the identical request.
  it('reports declared sample rate and length16ths against the stem files', async () => {
    const client = new EndlesssClient({ userAgent: 'hoppper-sdk-integration/0.1.0' });
    await client.login(username!, password!);

    const riffs: Awaited<ReturnType<typeof client.getRiffs>> = [];
    for await (const page of client.iterateRiffs(jamId!, { pageSize: 8 })) {
      for (const r of page) {
        if (r.slots.filter((s) => s.on).length > 0) riffs.push(r);
        if (riffs.length >= probeRiffCount) break;
      }
      if (riffs.length >= probeRiffCount) break;
    }
    if (riffs.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[probe] no riff with active slots — nothing to compare');
      return;
    }

    const transport = new HttpTransport({ userAgent: 'hoppper-sdk-integration/0.1.0' });
    const fetcher = new StemFetcher({ transport, cache: new InMemoryStemCache() });

    const rateMismatches: string[] = [];
    const lengthMismatches: string[] = [];
    const tempoMismatches: string[] = [];
    let compared = 0;

    for (const riff of riffs) {
      const stemIds = [
        ...new Set(
          riff.slots
            .filter((s) => s.on)
            .map((s) => s.stemId)
            .filter((id): id is NonNullable<typeof id> => id !== null),
        ),
      ];
      const docs = await client.getStemDocuments(jamId!, stemIds);
      const resolved = docs.map((doc) => (doc ? resolveStemUrl(doc) : null));
      const blobs = await fetcher.fetchRiff(jamId!, resolved);

      // eslint-disable-next-line no-console
      console.log(`[probe] riff ${riff.riffId} — riff bps ${riff.bps}, barLength ${riff.barLength}`);

      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        const stem = resolved[i];
        const blob = blobs[i];
        if (!doc || !stem || !blob) continue;

        let header;
        try {
          header = readAudioHeader(blob.bytes, stem.format);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.log(
            `[probe]   ${doc.stemId} ${stem.format}: header unreadable — ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          continue;
        }
        compared++;

        const intendedSec =
          doc.bps > 0 && doc.length16ths > 0 ? doc.length16ths / 4 / doc.bps : null;
        const encodedSec = header.durationSec;
        const rateRatio = header.sampleRate > 0 ? doc.sampleRate / header.sampleRate : NaN;

        // eslint-disable-next-line no-console
        console.log(
          `[probe]   ${doc.stemId} ${stem.format}: ` +
            `declared ${doc.sampleRate}Hz vs encoded ${header.sampleRate}Hz ` +
            `(ratio ${rateRatio.toFixed(6)}), ` +
            `length16ths ${doc.length16ths} @ ${doc.bps}bps → ` +
            `${intendedSec === null ? 'n/a' : `${intendedSec.toFixed(3)}s`} vs encoded ` +
            `${encodedSec === null ? 'unknown' : `${encodedSec.toFixed(3)}s`}, ` +
            `${header.channels}ch` +
            (header.bitsPerSample === null ? '' : ` ${header.bitsPerSample}bit`),
        );

        // Rates are integers on the wire; the document stores a float, so
        // compare with a tolerance rather than by identity.
        if (Math.abs(doc.sampleRate - header.sampleRate) > 0.5) {
          rateMismatches.push(
            `${doc.stemId}: declared ${doc.sampleRate}Hz, encoded ${header.sampleRate}Hz ` +
              `(playback would need rate ×${rateRatio.toFixed(6)})`,
          );
        }
        if (intendedSec !== null && encodedSec !== null) {
          // One decoded block of slack, or 1%, whichever is larger.
          const tolerance = Math.max(0.025, intendedSec * 0.01);
          if (Math.abs(intendedSec - encodedSec) > tolerance) {
            lengthMismatches.push(
              `${doc.stemId}: length16ths implies ${intendedSec.toFixed(3)}s, ` +
                `file holds ${encodedSec.toFixed(3)}s ` +
                `(ratio ${(encodedSec / intendedSec).toFixed(6)})`,
            );
          }
        }
        // bps is stored as a float32, so the same tempo differs in the last
        // few digits between documents. Only a real tempo gap is interesting.
        if (doc.bps > 0 && Math.abs(doc.bps - riff.bps) / riff.bps > 1e-3) {
          tempoMismatches.push(
            `${doc.stemId}: stem is ${doc.bps}bps, riff plays at ${riff.bps}bps`,
          );
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `[probe] compared ${compared} stem(s) across ${riffs.length} riff(s): ` +
        `${rateMismatches.length} rate mismatch(es), ` +
        `${lengthMismatches.length} length mismatch(es), ` +
        `${tempoMismatches.length} stem/riff tempo difference(s)`,
    );
    expect(compared).toBeGreaterThan(0);

    // Stems recorded at another tempo are expected in Endlesss and are not a
    // defect on their own — report them, don't fail on them.
    if (tempoMismatches.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[probe] stem/riff tempo differences:\n  ${tempoMismatches.join('\n  ')}`);
    }

    // These two are the assumptions the audio engine is built on. If either
    // fails, the fix is to carry bps/length16ths/sampleRate through
    // ResolvedStem and resample per LORE.
    expect(
      rateMismatches,
      `stem documents declare a sample rate the audio is not encoded at, so ` +
        `decodeAudioData plays them at the wrong speed:\n  ${rateMismatches.join('\n  ')}`,
    ).toEqual([]);
    expect(
      lengthMismatches,
      `stem length16ths/bps disagree with the encoded audio length, so loop ` +
        `length inferred from the decoded buffer is wrong:\n  ${lengthMismatches.join('\n  ')}`,
    ).toEqual([]);
  }, 120_000);
});

describe.skipIf(optedIn)('EndlesssClient (live) — skipped (opt-in)', () => {
  it('is skipped: set HOPPPER_RUN_LIVE_TESTS=1 + credentials in packages/sdk/.env.local to enable', () => {
    expect(optedIn).toBe(false);
  });
});
