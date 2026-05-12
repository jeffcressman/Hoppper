import {
  HttpTransport,
  type HttpTransportOptions,
  type LogEntry,
  type RetryPolicy,
} from './transport.js';
import { InMemoryTokenStore, type TokenStore } from './token-store.js';
import type { AuthSession } from './types.js';

const DEFAULT_API_DOMAIN = 'https://api.endlesss.fm';
const DEFAULT_DATA_DOMAIN = 'https://data.endlesss.fm';

export interface EndlesssClientOptions {
  fetch?: typeof fetch;
  userAgent?: string;
  tokenStore?: TokenStore;
  logger?: (entry: LogEntry) => void;
  retry?: Partial<RetryPolicy>;
  apiDomain?: string;
  dataDomain?: string;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SubscribedJamSummary {
  jamId: string;
  joinedAt: string;
}

export class AuthError extends Error {
  readonly name = 'AuthError';
  constructor(message: string) {
    super(message);
  }
}

interface RawLoginSuccess {
  token: string;
  password: string;
  user_id: string;
  expires: number;
}

interface RawSubscribedJamsResponse {
  total_rows: number;
  offset: number;
  rows: Array<{ id: string; key: string; value?: unknown }>;
}

export class EndlesssClient {
  private readonly transport: HttpTransport;
  private readonly tokenStore: TokenStore;
  private readonly apiDomain: string;
  private readonly dataDomain: string;
  private readonly now: () => number;
  private cached: AuthSession | null = null;

  constructor(opts: EndlesssClientOptions = {}) {
    const transportOpts: HttpTransportOptions = {
      fetch: opts.fetch,
      userAgent: opts.userAgent,
      logger: opts.logger,
      retry: opts.retry,
      random: opts.random,
      sleep: opts.sleep,
    };
    this.transport = new HttpTransport(transportOpts);
    this.tokenStore = opts.tokenStore ?? new InMemoryTokenStore();
    this.apiDomain = opts.apiDomain ?? DEFAULT_API_DOMAIN;
    this.dataDomain = opts.dataDomain ?? DEFAULT_DATA_DOMAIN;
    this.now = opts.now ?? (() => Date.now());
  }

  async login(username: string, password: string): Promise<AuthSession> {
    let raw: unknown;
    try {
      raw = await this.transport.request<unknown>({
        url: `${this.apiDomain}/auth/login`,
        method: 'POST',
        body: { username, password },
      });
    } catch (err) {
      // Auth failures come back as 4xx with a `{ message }` body. Surface those
      // as AuthError; let any other HTTP/network error bubble up untouched.
      const httpErr = err as { name?: string; status?: number; bodyJson?: unknown };
      if (httpErr?.name === 'HttpError') {
        const msg = extractFailureMessage(httpErr.bodyJson);
        if (msg) throw new AuthError(msg);
      }
      throw err;
    }

    const session = parseLoginResponse(raw);
    await this.tokenStore.save(session);
    this.cached = session;
    return session;
  }

  async logout(): Promise<void> {
    this.cached = null;
    await this.tokenStore.clear();
  }

  async getSession(): Promise<AuthSession | null> {
    if (this.cached) return this.cached;
    this.cached = await this.tokenStore.load();
    return this.cached;
  }

  isSessionExpired(session: AuthSession | null, now: number = this.now()): boolean {
    if (!session) return true;
    return now > session.expiresAt;
  }

  async getSubscribedJams(): Promise<SubscribedJamSummary[]> {
    const session = await this.requireValidSession();
    const userPath = escapeCouchUserName(session.userId);
    const url = `${this.dataDomain}/user_appdata$${userPath}/_design/membership/_view/getMembership`;

    const raw = await this.transport.request<RawSubscribedJamsResponse>({
      url,
      method: 'GET',
      auth: { kind: 'basic', token: session.token, password: session.password },
    });

    return raw.rows.map((row) => ({ jamId: row.id, joinedAt: row.key }));
  }

  private async requireValidSession(): Promise<AuthSession> {
    const session = await this.getSession();
    if (!session) throw new AuthError('not logged in');
    if (this.isSessionExpired(session)) throw new AuthError('session expired');
    return session;
  }
}

function parseLoginResponse(raw: unknown): AuthSession {
  const msg = extractFailureMessage(raw);
  if (msg) throw new AuthError(msg);

  if (!isLoginSuccess(raw)) {
    throw new AuthError('login response did not contain token/password');
  }
  return {
    token: raw.token,
    password: raw.password,
    userId: raw.user_id,
    expiresAt: raw.expires,
  };
}

function extractFailureMessage(raw: unknown): string | null {
  if (raw && typeof raw === 'object' && typeof (raw as { message?: unknown }).message === 'string') {
    return (raw as { message: string }).message;
  }
  return null;
}

function isLoginSuccess(raw: unknown): raw is RawLoginSuccess {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.token === 'string' &&
    typeof r.password === 'string' &&
    typeof r.user_id === 'string' &&
    typeof r.expires === 'number'
  );
}

// Personal jam CouchIDs are the username verbatim; CouchDB paths can't carry
// hyphens, so LORE escapes them as `(2d)`. Subscribed-jams view path uses the
// same escape rule.
function escapeCouchUserName(name: string): string {
  return name.replace(/-/g, '(2d)');
}
