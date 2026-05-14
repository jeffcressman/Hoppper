import { invoke } from '@tauri-apps/api/core';

// A fetch()-shaped function backed by a Rust reqwest::Client pinned to
// HTTP/1.1. tauri-plugin-http's default reqwest negotiates HTTP/2, and
// Endlesss's Cloudflare-fronted endpoints 500 on the resulting client
// fingerprint while accepting the same request over HTTP/1.1 (verified
// with curl and undici).
//
// We implement the subset of the fetch contract the SDK's HttpTransport
// uses: method, headers, body (string or Uint8Array). The returned Response
// only needs `status`, `text()`, and `arrayBuffer()` because that's all
// HttpTransport consumes; we don't aim for full standards compliance.

interface RustResponse {
  status: number;
  headers: Array<[string, string]>;
  bodyBase64: string;
}

function base64Encode(bytes: Uint8Array): string {
  // btoa expects a latin-1 string; build one byte-by-byte.
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function base64Decode(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function headersToEntries(init?: HeadersInit): Array<[string, string]> {
  if (!init) return [];
  if (Array.isArray(init)) return init.map(([k, v]) => [k, v]);
  if (init instanceof Headers) {
    const out: Array<[string, string]> = [];
    init.forEach((v, k) => out.push([k, v]));
    return out;
  }
  return Object.entries(init);
}

async function bodyToBase64(body: BodyInit | null | undefined): Promise<string> {
  if (body == null) return '';
  if (typeof body === 'string') {
    return base64Encode(new TextEncoder().encode(body));
  }
  if (body instanceof Uint8Array) return base64Encode(body);
  if (body instanceof ArrayBuffer) return base64Encode(new Uint8Array(body));
  throw new Error(`endlesssHttpFetch: unsupported body type ${typeof body}`);
}

export const endlesssHttpFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? 'GET';
  const headers = headersToEntries(init?.headers);
  const bodyBase64 = await bodyToBase64(init?.body ?? null);

  const result = await invoke<RustResponse>('endlesss_http_fetch', {
    req: { method, url, headers, bodyBase64 },
  });

  const bytes = base64Decode(result.bodyBase64);
  const responseHeaders = new Headers(result.headers);
  // Construct a real Response so the SDK's transport can call .text() /
  // .arrayBuffer() / .status as if this were the native fetch. Pass an
  // ArrayBuffer; TS's BodyInit no longer accepts Uint8Array directly.
  // bytes.buffer is typed as ArrayBuffer | SharedArrayBuffer in modern
  // TS; cast to ArrayBuffer (base64Decode allocates a fresh non-shared one).
  const buf = (bytes.buffer as ArrayBuffer).slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  return new Response(buf, {
    status: result.status,
    headers: responseHeaders,
  });
};
