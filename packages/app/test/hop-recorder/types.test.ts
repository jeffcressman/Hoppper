import { describe, it, expect } from 'vitest';
import {
  parseSequence,
  serializeSequence,
  type HopSequence,
} from '../../src/hop-recorder/types.js';

function fixture(): HopSequence {
  return {
    schemaVersion: 1,
    id: 'seq-abc',
    title: 'Test session',
    jamId: 'band-test',
    recordedAt: '2026-05-14T12:34:56.000Z',
    durationSec: 42.5,
    hops: [
      { tSec: 0, riffId: 'riff-1', jamId: 'band-test', transitionMs: 0 },
      { tSec: 8.25, riffId: 'riff-2', jamId: 'band-test', transitionMs: 250 },
      { tSec: 17.0, riffId: 'riff-3', jamId: 'band-test', transitionMs: 500 },
    ],
  };
}

describe('HopSequence serialization', () => {
  it('round-trips through serialize + parse', () => {
    const seq = fixture();
    const json = serializeSequence(seq);
    const parsed = parseSequence(json);
    expect(parsed).toEqual(seq);
  });

  it('produces canonical key order in serialized output', () => {
    const seq = fixture();
    const json = serializeSequence(seq);
    // schemaVersion must come first so that mismatched versions can be
    // detected by a streaming reader without parsing the full payload.
    expect(json).toMatch(/^\{\s*"schemaVersion":\s*1/);
  });

  it('produces pretty-printed JSON (2-space indent)', () => {
    // Sequences are human-edited in the editor phase; pretty-printing
    // matters for diff-friendliness.
    const json = serializeSequence(fixture());
    expect(json).toContain('\n  ');
  });
});

describe('parseSequence', () => {
  it('rejects unknown schemaVersion', () => {
    const bad = JSON.stringify({ ...fixture(), schemaVersion: 99 });
    expect(() => parseSequence(bad)).toThrow(/schemaVersion/i);
  });

  it('rejects missing schemaVersion', () => {
    const { schemaVersion: _, ...rest } = fixture();
    void _;
    const bad = JSON.stringify(rest);
    expect(() => parseSequence(bad)).toThrow(/schemaVersion/i);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseSequence('not json at all')).toThrow();
  });

  it('rejects missing required fields', () => {
    const { id: _, ...rest } = fixture();
    void _;
    const bad = JSON.stringify({ ...rest, schemaVersion: 1 });
    expect(() => parseSequence(bad)).toThrow(/id/i);
  });

  it('rejects malformed hops', () => {
    const bad = JSON.stringify({
      ...fixture(),
      hops: [{ tSec: 0, riffId: 'r', jamId: 'j' /* missing transitionMs */ }],
    });
    expect(() => parseSequence(bad)).toThrow(/transitionMs/i);
  });

  it('rejects non-string ids', () => {
    const bad = JSON.stringify({ ...fixture(), id: 42 });
    expect(() => parseSequence(bad)).toThrow(/id/i);
  });
});
