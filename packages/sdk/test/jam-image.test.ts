import { describe, it, expect } from 'vitest';
import { jamImageUrl } from '../src/jam-image.js';
import * as sdk from '../src/index.js';

describe('jamImageUrl', () => {
  it('is the jam’s avatar on the Endlesss CDN, keyed by its couch ID', () => {
    expect(jamImageUrl('bandf203488b88')).toBe(
      'https://endlesss.ams3.cdn.digitaloceanspaces.com/attachments/avatars/bandf203488b88',
    );
  });

  it('encodes an ID that isn’t URL-safe', () => {
    expect(jamImageUrl('a b/c')).toBe(
      'https://endlesss.ams3.cdn.digitaloceanspaces.com/attachments/avatars/a%20b%2Fc',
    );
  });

  it('is exported from the SDK', () => {
    expect(sdk.jamImageUrl).toBe(jamImageUrl);
  });
});
