import { describe, it, expect } from 'vitest';
import { parseStemDocument, resolveStemUrl } from '../src/parse.js';

function rawStemDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'stem-1',
    bps: 2.0,
    length16ths: 16,
    originalPitch: 0,
    barLength: 4,
    presetName: 'preset',
    creatorUserName: 'alice',
    primaryColour: 'ff4d9de0',
    sampleRate: 44100.0,
    created: 1_700_000_000_000,
    cdn_attachments: {
      oggAudio: {
        endpoint: 'ndls-att0.fra1.digitaloceanspaces.com',
        key: 'attachments/oggAudio/band/stem-1',
        url: 'https://ndls-att0.fra1.digitaloceanspaces.com/attachments/oggAudio/band/stem-1',
        length: 12345,
        mime: 'audio/ogg',
      },
      flacAudio: {
        endpoint: 'endlesss-dev.fra1.digitaloceanspaces.com',
        key: 'attachments/flacAudio/band/stem-1',
        url: 'https://endlesss-dev.fra1.digitaloceanspaces.com/attachments/flacAudio/band/stem-1',
        length: 67890,
        mime: 'audio/flac',
      },
    },
    ...overrides,
  };
}

describe('parseStemDocument', () => {
  it('parses a well-formed stem doc with both ogg and flac', () => {
    const stem = parseStemDocument(rawStemDoc());
    expect(stem.stemId).toBe('stem-1');
    expect(stem.bps).toBe(2.0);
    expect(stem.sampleRate).toBe(44100.0);
    expect(stem.ogg?.format).toBe('ogg');
    expect(stem.ogg?.length).toBe(12345);
    expect(stem.flac?.format).toBe('flac');
    expect(stem.flac?.length).toBe(67890);
  });

  it('returns ogg=null when the oggAudio block is entirely empty', () => {
    const stem = parseStemDocument(
      rawStemDoc({
        cdn_attachments: {
          oggAudio: { endpoint: '', key: '', url: '', length: 0 },
          flacAudio: rawStemDoc().cdn_attachments.flacAudio,
        },
      }),
    );
    expect(stem.ogg).toBeNull();
    expect(stem.flac).not.toBeNull();
  });

  it('returns both null when cdn_attachments is missing', () => {
    const stem = parseStemDocument(
      rawStemDoc({
        cdn_attachments: undefined,
      }),
    );
    expect(stem.ogg).toBeNull();
    expect(stem.flac).toBeNull();
  });

  it('quirk #4: derives missing ogg key from URL path', () => {
    const stem = parseStemDocument(
      rawStemDoc({
        cdn_attachments: {
          oggAudio: {
            endpoint: 'ndls-att0.fra1.digitaloceanspaces.com',
            url: 'https://ndls-att0.fra1.digitaloceanspaces.com/attachments/oggAudio/band/derived-key',
            length: 10,
            mime: 'audio/ogg',
          },
          flacAudio: undefined,
        },
      }),
    );
    expect(stem.ogg?.key).toBe('attachments/oggAudio/band/derived-key');
  });

  it('quirk #5: strips http(s):// prefix from endpoint', () => {
    const stem = parseStemDocument(
      rawStemDoc({
        cdn_attachments: {
          oggAudio: {
            endpoint: 'https://ndls-att0.fra1.digitaloceanspaces.com',
            key: 'attachments/oggAudio/band/k',
            url: 'https://ndls-att0.fra1.digitaloceanspaces.com/attachments/oggAudio/band/k',
            length: 10,
            mime: 'audio/ogg',
          },
          flacAudio: undefined,
        },
      }),
    );
    expect(stem.ogg?.endpoint).toBe('ndls-att0.fra1.digitaloceanspaces.com');
  });

  it('quirk #6: when bucket is already prepended to endpoint, clear bucket', () => {
    const stem = parseStemDocument(
      rawStemDoc({
        cdn_attachments: {
          oggAudio: {
            bucket: 'ndls-att0',
            endpoint: 'ndls-att0.fra1.digitaloceanspaces.com',
            key: 'attachments/oggAudio/band/k',
            url: 'https://ndls-att0.fra1.digitaloceanspaces.com/attachments/oggAudio/band/k',
            length: 10,
            mime: 'audio/ogg',
          },
          flacAudio: undefined,
        },
      }),
    );
    expect(stem.ogg?.bucket).toBeUndefined();
    expect(stem.ogg?.endpoint).toBe('ndls-att0.fra1.digitaloceanspaces.com');
  });

  it('preserves optional boolean fields when present', () => {
    const stem = parseStemDocument(rawStemDoc({ isDrum: true, isMic: false }));
    expect(stem.isDrum).toBe(true);
    expect(stem.isMic).toBe(false);
    expect(stem.isNote).toBeUndefined();
  });
});

describe('resolveStemUrl', () => {
  it('prefers FLAC when present and length > 0', () => {
    const stem = parseStemDocument(rawStemDoc());
    const resolved = resolveStemUrl(stem);
    expect(resolved?.format).toBe('flac');
    expect(resolved?.url).toContain('endlesss-dev');
    expect(resolved?.length).toBe(67890);
    expect(resolved?.mime).toBe('audio/flac');
  });

  it('falls back to OGG when FLAC length is 0', () => {
    const stem = parseStemDocument(
      rawStemDoc({
        cdn_attachments: {
          oggAudio: rawStemDoc().cdn_attachments.oggAudio,
          flacAudio: {
            endpoint: '',
            key: '',
            url: '',
            length: 0,
          },
        },
      }),
    );
    const resolved = resolveStemUrl(stem);
    expect(resolved?.format).toBe('ogg');
  });

  it('returns null when neither attachment is usable', () => {
    const stem = parseStemDocument(
      rawStemDoc({
        cdn_attachments: {
          oggAudio: undefined,
          flacAudio: undefined,
        },
      }),
    );
    expect(resolveStemUrl(stem)).toBeNull();
  });

  it('constructs the URL from endpoint+key when the url field is empty', () => {
    const stem = parseStemDocument(
      rawStemDoc({
        cdn_attachments: {
          oggAudio: {
            endpoint: 'ndls-att0.fra1.digitaloceanspaces.com',
            key: 'attachments/oggAudio/band/k',
            url: '',
            length: 50,
            mime: 'audio/ogg',
          },
          flacAudio: undefined,
        },
      }),
    );
    const resolved = resolveStemUrl(stem);
    expect(resolved?.url).toBe(
      'https://ndls-att0.fra1.digitaloceanspaces.com/attachments/oggAudio/band/k',
    );
  });
});
