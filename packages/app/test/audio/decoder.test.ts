import { describe, it, expect, vi } from 'vitest';
import type { StemFormat } from '@hoppper/sdk';
import {
  createDecoder,
  UnsupportedFormatError,
  type FormatDecoder,
} from '../../src/audio/decoder.js';
import type { AudioBufferLike } from '../../src/audio/audio-buffer-cache.js';

function fakeBuffer(label: string): AudioBufferLike {
  return {
    length: 1,
    numberOfChannels: 1,
    sampleRate: 48000,
    duration: 0.001,
    // Smuggle a label so tests can assert which decoder produced it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ _label: label } as any),
  };
}

function stubDecoder(label: string): FormatDecoder {
  return {
    decode: vi.fn().mockResolvedValue(fakeBuffer(label)),
  };
}

describe('createDecoder', () => {
  it('dispatches ogg bytes to the ogg decoder', async () => {
    const ogg = stubDecoder('ogg');
    const flac = stubDecoder('flac');
    const decoder = createDecoder({ ogg, flac });
    const bytes = new Uint8Array([1, 2, 3]);
    const result = (await decoder.decode(bytes, 'ogg')) as AudioBufferLike & {
      _label: string;
    };
    expect(result._label).toBe('ogg');
    expect(ogg.decode).toHaveBeenCalledWith(bytes);
    expect(flac.decode).not.toHaveBeenCalled();
  });

  it('dispatches flac bytes to the flac decoder', async () => {
    const ogg = stubDecoder('ogg');
    const flac = stubDecoder('flac');
    const decoder = createDecoder({ ogg, flac });
    const bytes = new Uint8Array([9, 8, 7]);
    const result = (await decoder.decode(bytes, 'flac')) as AudioBufferLike & {
      _label: string;
    };
    expect(result._label).toBe('flac');
    expect(flac.decode).toHaveBeenCalledWith(bytes);
    expect(ogg.decode).not.toHaveBeenCalled();
  });

  it('throws UnsupportedFormatError for an unknown format', async () => {
    const decoder = createDecoder({
      ogg: stubDecoder('ogg'),
      flac: stubDecoder('flac'),
    });
    await expect(
      decoder.decode(new Uint8Array(), 'mp3' as StemFormat),
    ).rejects.toBeInstanceOf(UnsupportedFormatError);
  });

  it('propagates errors thrown by a backing decoder', async () => {
    const failing: FormatDecoder = {
      decode: vi.fn().mockRejectedValue(new Error('decode failed')),
    };
    const decoder = createDecoder({ ogg: failing, flac: stubDecoder('flac') });
    await expect(decoder.decode(new Uint8Array(), 'ogg')).rejects.toThrow(
      'decode failed',
    );
  });
});
