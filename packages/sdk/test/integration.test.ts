import { describe, it, expect } from 'vitest';
import { EndlesssClient } from '../src/index.js';

// Live integration test against api.endlesss.fm + data.endlesss.fm.
// Auto-skipped unless HOPPPER_ENDLESSS_USERNAME and HOPPPER_ENDLESSS_PASSWORD
// are provided (via packages/sdk/.env.local).

const username = process.env.HOPPPER_ENDLESSS_USERNAME;
const password = process.env.HOPPPER_ENDLESSS_PASSWORD;
const live = Boolean(username && password);

describe.skipIf(!live)('EndlesssClient (live)', () => {
  it('logs in and fetches the subscribed-jam list', async () => {
    const client = new EndlesssClient({ userAgent: 'hoppper-sdk-integration/0.1.0' });

    const session = await client.login(username!, password!);
    expect(session.token).toMatch(/\S/);
    expect(session.password).toMatch(/\S/);
    // `user_id` in the response is the canonical Endlesss username; the login
    // form accepts either username or email, so don't assume it equals the env value.
    expect(session.userId).toMatch(/\S/);
    expect(session.expiresAt).toBeGreaterThan(Date.now());

    const jams = await client.getSubscribedJams();
    expect(Array.isArray(jams)).toBe(true);
    for (const jam of jams) {
      expect(typeof jam.jamId).toBe('string');
      expect(jam.jamId.length).toBeGreaterThan(0);
      expect(typeof jam.joinedAt).toBe('string');
    }
    // Log one for human verification when running locally.
    if (jams.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[integration] fetched ${jams.length} subscribed jam(s); first =`, jams[0]);
    } else {
      // eslint-disable-next-line no-console
      console.log('[integration] account has zero subscribed jams; auth still verified end-to-end');
    }
  }, 30_000);
});

describe.skipIf(live)('EndlesssClient (live) — skipped', () => {
  it('is skipped: provide HOPPPER_ENDLESSS_USERNAME/_PASSWORD in packages/sdk/.env.local to enable', () => {
    expect(live).toBe(false);
  });
});
