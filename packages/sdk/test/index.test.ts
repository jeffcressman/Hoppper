import { describe, it, expect } from 'vitest';
import * as sdk from '../src/index.js';

describe('@hoppper/sdk', () => {
  it('exports SDK_VERSION', () => {
    expect(sdk.SDK_VERSION).toBe('0.1.0');
  });

  it('exports resolveStemUrl, so a caller holding stem documents can build URLs without refetching them', () => {
    expect(typeof sdk.resolveStemUrl).toBe('function');
  });
});
