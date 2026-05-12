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
export type { AuthSession } from './types.js';
