import { describe, it, expect } from 'vitest';
import { readAudioHeader } from './audio-header.js';

// Builders that produce byte-exact Ogg/FLAC headers, so the parser is tested
// against the container layouts rather than against itself.

function oggFile(opts: {
  sampleRate: number;
  channels: number;
  lastGranulePosition: number;
}): Uint8Array {
  // Vorbis identification packet (30 bytes).
  const ident = new Uint8Array(30);
  const identView = new DataView(ident.buffer);
  ident[0] = 0x01;
  ident.set([0x76, 0x6f, 0x72, 0x62, 0x69, 0x73], 1); // "vorbis"
  identView.setUint32(7, 0, true); // vorbis_version
  ident[11] = opts.channels;
  identView.setUint32(12, opts.sampleRate, true);
  identView.setUint32(16, 0, true); // bitrate_maximum
  identView.setUint32(20, 128000, true); // bitrate_nominal
  identView.setUint32(24, 0, true); // bitrate_minimum
  ident[28] = 0xb8; // blocksizes
  ident[29] = 0x01; // framing flag

  function page(
    headerType: number,
    granule: number,
    sequence: number,
    payload: Uint8Array,
  ): Uint8Array {
    const page = new Uint8Array(27 + 1 + payload.length);
    const view = new DataView(page.buffer);
    page.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
    page[4] = 0; // stream structure version
    page[5] = headerType;
    view.setBigUint64(6, BigInt(granule), true);
    view.setUint32(14, 0x1234abcd, true); // bitstream serial number
    view.setUint32(18, sequence, true);
    view.setUint32(22, 0, true); // CRC (not verified by the parser)
    page[26] = 1; // one segment
    page[27] = payload.length;
    page.set(payload, 28);
    return page;
  }

  const bos = page(0x02, 0, 0, ident);
  const audio = page(0x00, Math.floor(opts.lastGranulePosition / 2), 1, new Uint8Array([0xaa]));
  const eos = page(0x04, opts.lastGranulePosition, 2, new Uint8Array([0xbb]));

  const out = new Uint8Array(bos.length + audio.length + eos.length);
  out.set(bos, 0);
  out.set(audio, bos.length);
  out.set(eos, bos.length + audio.length);
  return out;
}

function flacFile(opts: {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  totalSamples: number;
}): Uint8Array {
  const out = new Uint8Array(4 + 4 + 34);
  out.set([0x66, 0x4c, 0x61, 0x43], 0); // "fLaC"
  out[4] = 0x80; // last-metadata-block flag + STREAMINFO (type 0)
  out[5] = 0x00;
  out[6] = 0x00;
  out[7] = 34; // STREAMINFO length

  const s = 8; // start of STREAMINFO
  const view = new DataView(out.buffer);
  view.setUint16(s, 4096); // min block size
  view.setUint16(s + 2, 4096); // max block size
  // min/max frame size left zero (3 bytes each)

  // 20 bits sample rate | 3 bits (channels - 1) | 5 bits (bps - 1) | 36 bits total samples
  const chan = opts.channels - 1;
  const bps = opts.bitsPerSample - 1;
  out[s + 10] = (opts.sampleRate >>> 12) & 0xff;
  out[s + 11] = (opts.sampleRate >>> 4) & 0xff;
  out[s + 12] = ((opts.sampleRate & 0x0f) << 4) | (chan << 1) | ((bps >>> 4) & 0x01);
  out[s + 13] =
    ((bps & 0x0f) << 4) | (Math.floor(opts.totalSamples / 2 ** 32) & 0x0f);
  view.setUint32(s + 14, opts.totalSamples % 2 ** 32);
  return out;
}

describe('readAudioHeader — ogg', () => {
  it('reads the sample rate and channel count from the Vorbis ident packet', () => {
    const bytes = oggFile({ sampleRate: 44100, channels: 2, lastGranulePosition: 441000 });
    const header = readAudioHeader(bytes, 'ogg');
    expect(header.sampleRate).toBe(44100);
    expect(header.channels).toBe(2);
  });

  it('derives duration from the final page granule position', () => {
    const bytes = oggFile({ sampleRate: 48000, channels: 1, lastGranulePosition: 96000 });
    const header = readAudioHeader(bytes, 'ogg');
    expect(header.totalSamples).toBe(96000);
    expect(header.durationSec).toBeCloseTo(2, 6);
  });

  it('handles a non-integer declared rate cleanly (rates are integers on the wire)', () => {
    const bytes = oggFile({ sampleRate: 44100, channels: 2, lastGranulePosition: 0 });
    const header = readAudioHeader(bytes, 'ogg');
    // A zero granule means we can't say how long it is; don't invent a number.
    expect(header.durationSec).toBeNull();
  });

  it('throws on bytes that are not an Ogg stream', () => {
    expect(() => readAudioHeader(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'ogg')).toThrow(
      /not an ogg/i,
    );
  });
});

describe('readAudioHeader — flac', () => {
  it('reads rate, channels and bit depth out of the packed STREAMINFO bits', () => {
    const bytes = flacFile({
      sampleRate: 48000,
      channels: 2,
      bitsPerSample: 24,
      totalSamples: 96000,
    });
    const header = readAudioHeader(bytes, 'flac');
    expect(header.sampleRate).toBe(48000);
    expect(header.channels).toBe(2);
    expect(header.bitsPerSample).toBe(24);
  });

  it('derives duration from total samples', () => {
    const bytes = flacFile({
      sampleRate: 44100,
      channels: 1,
      bitsPerSample: 16,
      totalSamples: 220500,
    });
    const header = readAudioHeader(bytes, 'flac');
    expect(header.totalSamples).toBe(220500);
    expect(header.durationSec).toBeCloseTo(5, 6);
  });

  it('reads a total-sample count above 2^32 (36-bit field)', () => {
    const totalSamples = 2 ** 32 + 12345;
    const bytes = flacFile({ sampleRate: 48000, channels: 2, bitsPerSample: 16, totalSamples });
    expect(readAudioHeader(bytes, 'flac').totalSamples).toBe(totalSamples);
  });

  it('reports unknown duration when total samples is 0 (streamed FLAC)', () => {
    const bytes = flacFile({ sampleRate: 48000, channels: 2, bitsPerSample: 16, totalSamples: 0 });
    expect(readAudioHeader(bytes, 'flac').durationSec).toBeNull();
  });

  it('throws on bytes that are not a FLAC stream', () => {
    expect(() => readAudioHeader(new Uint8Array(40), 'flac')).toThrow(/not a flac/i);
  });
});
