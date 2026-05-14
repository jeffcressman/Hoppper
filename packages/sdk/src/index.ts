export const SDK_VERSION = '0.1.0';

export {
  EndlesssClient,
  AuthError,
  type EndlesssClientOptions,
  type SubscribedJamSummary,
} from './client.js';
export {
  HttpTransport,
  HttpError,
  NetworkError,
  type AuthMode,
  type HttpTransportOptions,
  type LogEntry,
  type RetryPolicy,
  type TransportRequest,
} from './transport.js';
export {
  InMemoryTokenStore,
  FileTokenStore,
  type TokenStore,
} from './token-store.js';
export * from './types/index.js';
export {
  ReadonlyCacheError,
  type StemBlob,
  type StemCache,
  type StemCachePutKey,
} from './stems/cache.js';
export { InMemoryStemCache } from './stems/in-memory-cache.js';
export { FilesystemStemCache } from './stems/fs-cache.js';
export { ReadonlyLoreStemDir } from './stems/lore-readonly.js';
export { LayeredStemCache } from './stems/layered-cache.js';
export { nodeFsAdapter, type FsAdapter } from './stems/fs-adapter.js';
export {
  StemFetcher,
  StemIntegrityError,
  type StemFetcherOptions,
  type StemFetchLog,
} from './stems/fetcher.js';
export {
  prefetchRiffs,
  type PrefetchClient,
  type PrefetchHandle,
  type PrefetchOptions,
  type PrefetchProgress,
  type PrefetchResult,
} from './stems/prefetcher.js';
