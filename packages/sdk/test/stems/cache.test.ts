import { describe, it, expect } from 'vitest';
import { ReadonlyCacheError } from '../../src/stems/cache.js';

describe('ReadonlyCacheError', () => {
  it('carries a useful message naming the rejected operation', () => {
    const err = new ReadonlyCacheError('put');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ReadonlyCacheError');
    expect(err.message).toBe('Cannot put a read-only stem cache');
  });
});
