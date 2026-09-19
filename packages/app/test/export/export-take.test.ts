import { describe, it, expect, vi } from 'vitest';
import type { HopSequence } from '../../src/hop-recorder/types';
import { exportTake, exportFileName } from '../../src/export/export-take';

const take = { id: 't1', title: 'Sunday drift', durationSec: 1 } as HopSequence;

function deps(path: string | null) {
  return {
    chooseFile: vi.fn(async () => path),
    render: vi.fn(async () => ({ channels: [new Float32Array(4), new Float32Array(4)], sampleRate: 48000 })),
    write: vi.fn(async (_path: string, _bytes: Uint8Array) => {}),
  };
}

describe('exportTake', () => {
  it('asks where to save first, offering the take’s name', async () => {
    const d = deps('/Users/me/Sunday drift.wav');
    await exportTake(take, d);
    expect(d.chooseFile).toHaveBeenCalledWith('Sunday drift.wav');
  });

  it('renders the take and writes it as a WAV where it was asked to go', async () => {
    const d = deps('/Users/me/out.wav');
    expect(await exportTake(take, d)).toBe('saved');
    expect(d.render).toHaveBeenCalledWith(take);
    const [path, bytes] = d.write.mock.calls[0]!;
    expect(path).toBe('/Users/me/out.wav');
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
  });

  it('adds .wav when the name chosen hasn’t one', async () => {
    const d = deps('/Users/me/out');
    await exportTake(take, d);
    expect(d.write.mock.calls[0]![0]).toBe('/Users/me/out.wav');
  });

  it('does nothing when the dialog is cancelled', async () => {
    const d = deps(null);
    expect(await exportTake(take, d)).toBe('cancelled');
    expect(d.render).not.toHaveBeenCalled();
    expect(d.write).not.toHaveBeenCalled();
  });
});

describe('exportFileName', () => {
  it('keeps a take’s title, minus characters a file name can’t have', () => {
    expect(exportFileName('Dub run: take 2/3?')).toBe('Dub run take 23.wav');
  });

  it('falls back to a plain name for an untitled take', () => {
    expect(exportFileName('  ')).toBe('Hoppper hop.wav');
  });
});
