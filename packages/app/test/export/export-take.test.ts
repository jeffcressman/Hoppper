import { describe, it, expect, vi } from 'vitest';
import type { HopSequence } from '../../src/hop-recorder/types';
import { exportTake, exportFileName } from '../../src/export/export-take';

const take = { id: 't1', title: 'Sunday drift', durationSec: 1, recordedAt: '2026-09-14T12:00:00.000Z' } as HopSequence;

function deps(path: string | null) {
  return {
    chooseFile: vi.fn(async () => path),
    render: vi.fn(async () => ({ channels: [new Float32Array(4), new Float32Array(4)], sampleRate: 48000 })),
    write: vi.fn(async (_path: string, _bytes: Uint8Array) => {}),
  };
}

describe('exportTake', () => {
  it('asks where to save first, offering the jam, "hoppp", the day and the hop’s name', async () => {
    const d = deps('/Users/me/out.wav');
    await exportTake(take, d, 'Hoppper');
    expect(d.chooseFile).toHaveBeenCalledWith('Hoppper hoppp 2026-09-14 - Sunday drift.wav');
  });

  it('renders the take and writes it as a WAV where it was asked to go', async () => {
    const d = deps('/Users/me/out.wav');
    expect(await exportTake(take, d, 'Hoppper')).toBe('saved');
    expect(d.render).toHaveBeenCalledWith(take);
    const [path, bytes] = d.write.mock.calls[0]!;
    expect(path).toBe('/Users/me/out.wav');
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
  });

  it('adds .wav when the name chosen hasn’t one', async () => {
    const d = deps('/Users/me/out');
    await exportTake(take, d, 'Hoppper');
    expect(d.write.mock.calls[0]![0]).toBe('/Users/me/out.wav');
  });

  it('does nothing when the dialog is cancelled', async () => {
    const d = deps(null);
    expect(await exportTake(take, d, 'Hoppper')).toBe('cancelled');
    expect(d.render).not.toHaveBeenCalled();
    expect(d.write).not.toHaveBeenCalled();
  });
});

describe('exportFileName', () => {
  it('is "<jam> hoppp <day recorded> - <hop>.wav"', () => {
    expect(exportFileName('Hoppper', '2026-09-14T12:00:00.000Z', 'Sunday drift')).toBe(
      'Hoppper hoppp 2026-09-14 - Sunday drift.wav',
    );
  });

  it('drops characters a file name can’t have, from every part', () => {
    expect(exportFileName('Dub/Club', '2026-09-14T12:00:00.000Z', 'Dub run: take 2?')).toBe(
      'DubClub hoppp 2026-09-14 - Dub run take 2.wav',
    );
  });

  it('falls back to plain words for a missing jam or hop name', () => {
    expect(exportFileName('', '2026-09-14T12:00:00.000Z', '  ')).toBe('Jam hoppp 2026-09-14 - Hop.wav');
  });
});
