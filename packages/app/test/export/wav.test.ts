import { describe, it, expect } from 'vitest';
import { encodeWav } from '../../src/export/wav';

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const text = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.slice(at, at + 4));
const int24 = (v: DataView, at: number) => {
  const n = v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getUint8(at + 2) << 16);
  return n & 0x800000 ? n - 0x1000000 : n;
};

describe('encodeWav — 24-bit PCM', () => {
  const left = Float32Array.from([0, 0.5, -0.5, 1]);
  const right = Float32Array.from([0.25, -1, 0, -0.25]);
  const wav = encodeWav([left, right], 48000);
  const v = view(wav);

  it('is a RIFF/WAVE file with a PCM fmt chunk and one data chunk', () => {
    expect(text(wav, 0)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(wav.length - 8);
    expect(text(wav, 8)).toBe('WAVE');
    expect(text(wav, 12)).toBe('fmt ');
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(text(wav, 36)).toBe('data');
  });

  it('describes stereo, 48 kHz, 24-bit', () => {
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(28, true)).toBe(48000 * 2 * 3); // bytes per second
    expect(v.getUint16(32, true)).toBe(6); // block align
    expect(v.getUint16(34, true)).toBe(24);
    expect(v.getUint32(40, true)).toBe(4 * 2 * 3);
    expect(wav.length).toBe(44 + 4 * 2 * 3);
  });

  it('interleaves the channels, left first', () => {
    const at = (frame: number, ch: number) => int24(v, 44 + frame * 6 + ch * 3);
    expect(at(0, 0)).toBe(0);
    expect(at(0, 1)).toBe(Math.round(0.25 * 8388607));
    expect(at(1, 0)).toBe(Math.round(0.5 * 8388607));
    expect(at(1, 1)).toBe(-8388608);
    expect(at(3, 0)).toBe(8388607);
  });

  it('clips anything past full scale rather than wrapping round', () => {
    const loud = encodeWav([Float32Array.from([1.7, -2.2])], 44100);
    const lv = view(loud);
    expect(int24(lv, 44)).toBe(8388607);
    expect(int24(lv, 47)).toBe(-8388608);
  });
});
