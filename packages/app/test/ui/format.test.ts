import { describe, it, expect } from 'vitest';
import { formatDay, formatDuration, formatTime } from '../../src/ui/format';

describe('formatDay', () => {
  it('writes a date the way Endlesss does: day, short month, year', () => {
    expect(formatDay('2026-01-08T12:00:00.000Z')).toBe('8 Jan 2026');
  });

  it('accepts unix milliseconds, as rifff documents carry them', () => {
    expect(formatDay(Date.UTC(2026, 3, 26, 12))).toBe('26 Apr 2026');
  });
});

describe('formatDuration', () => {
  it('writes minutes and zero-padded seconds', () => {
    expect(formatDuration(252)).toBe('4:12');
    expect(formatDuration(7.9)).toBe('0:07');
  });
});

describe('formatTime', () => {
  it('writes a 24-hour clock time, in the user’s local time', () => {
    const at = new Date(2026, 8, 14, 9, 5).getTime();
    expect(formatTime(at)).toBe('09:05');
  });
});
