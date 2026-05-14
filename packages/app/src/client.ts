import { EndlesssClient } from '@hoppper/sdk';

// Module-singleton EndlesssClient initialized once at app boot with the
// Tauri-backed fetch + TokenStore. Stores look it up lazily on first use so
// boot-order issues fail loud with a clear message rather than silently
// instantiating a default client.
let _client: EndlesssClient | undefined;

export function initClient(c: EndlesssClient): void {
  _client = c;
}

export function getClient(): EndlesssClient {
  if (!_client) {
    throw new Error('Hoppper client not initialized — call initClient() before mounting the app');
  }
  return _client;
}
