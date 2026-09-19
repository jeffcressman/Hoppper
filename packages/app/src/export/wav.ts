/**
 * A WAV file of `channels` (one Float32Array per channel, all the same
 * length, -1..1) as 24-bit PCM. Samples past full scale are clipped, not
 * wrapped — eight stems summed can run hot.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const numChannels = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytesPerSample = 3;
  const blockAlign = numChannels * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));

  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bytesPerSample * 8, true);
  ascii(36, 'data');
  v.setUint32(40, dataBytes, true);

  let at = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < numChannels; c++) {
      const x = Math.max(-1, Math.min(1, channels[c]![f]!));
      const n = x < 0 ? Math.round(x * 8388608) : Math.round(x * 8388607);
      const u = n < 0 ? n + 0x1000000 : n;
      out[at] = u & 0xff;
      out[at + 1] = (u >> 8) & 0xff;
      out[at + 2] = (u >> 16) & 0xff;
      at += 3;
    }
  }
  return out;
}
