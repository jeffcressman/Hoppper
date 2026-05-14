import { describe, it, expect } from 'vitest';

describe('test harness', () => {
  it('runs vitest with happy-dom (document is defined)', () => {
    expect(typeof document).toBe('object');
    expect(document.body).toBeDefined();
  });
});
