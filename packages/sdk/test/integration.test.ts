import { describe, it, expect } from 'vitest';
import { EndlesssClient } from '../src/index.js';

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

const liveAuthReady = Boolean(optedIn && username && password);
const liveJamReady = Boolean(liveAuthReady && jamId);

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

describe.skipIf(optedIn)('EndlesssClient (live) — skipped (opt-in)', () => {
  it('is skipped: set HOPPPER_RUN_LIVE_TESTS=1 + credentials in packages/sdk/.env.local to enable', () => {
    expect(optedIn).toBe(false);
  });
});
