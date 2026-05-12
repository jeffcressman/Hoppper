import { describe, it, expect } from 'vitest';
import { applyLengthQuirk, coerceLength } from '../src/parse.js';

describe('applyLengthQuirk', () => {
  it('rewrites "length":"13" to "length":13', () => {
    const input = '{"length":"13"}';
    expect(applyLengthQuirk(input)).toBe('{"length":13}');
  });

  it('handles multiple occurrences', () => {
    const input = '[{"length":"100"},{"length":"42"}]';
    expect(applyLengthQuirk(input)).toBe('[{"length":100},{"length":42}]');
  });

  it('leaves correctly-typed "length":13 untouched', () => {
    const input = '{"length":13,"other":"length":"5"}';
    expect(applyLengthQuirk(input)).toBe('{"length":13,"other":"length":5}');
  });

  it('is a no-op when no length string occurs', () => {
    const input = '{"foo":"bar"}';
    expect(applyLengthQuirk(input)).toBe(input);
  });

  it('only touches digit-string values, not arbitrary strings that happen to follow length', () => {
    const input = '{"length":"abc"}';
    // We intentionally only fix the digit-only string form; "abc" is corrupt data
    // and should fail downstream parsing rather than be silently coerced.
    expect(applyLengthQuirk(input)).toBe('{"length":"abc"}');
  });
});

describe('coerceLength', () => {
  it('passes numbers through unchanged', () => {
    expect(coerceLength(42)).toBe(42);
    expect(coerceLength(0)).toBe(0);
  });

  it('parses digit-only strings to numbers', () => {
    expect(coerceLength('42')).toBe(42);
    expect(coerceLength('0')).toBe(0);
  });

  it('returns 0 for missing or unparseable values', () => {
    expect(coerceLength(undefined)).toBe(0);
    expect(coerceLength(null)).toBe(0);
    expect(coerceLength('')).toBe(0);
    expect(coerceLength('abc')).toBe(0);
  });
});
