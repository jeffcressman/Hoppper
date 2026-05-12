import {
  HttpTransport,
  type HttpTransportOptions,
  type LogEntry,
  type RetryPolicy,
} from './transport.js';
import { InMemoryTokenStore, type TokenStore } from './token-store.js';
import { applyLengthQuirk, parseRiffDocument, parseStemDocument, resolveStemUrl } from './parse.js';
import type {
  AuthSession,
  JamListing,
  JamProfile,
  JamRef,
  RiffCouchID,
  RiffDocument,
  RiffIndex,
  RiffIndexRow,
  ResolvedStem,
  StemCouchID,
  StemDocument,
} from './types/index.js';

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

interface RawJamProfile {
  displayName: string;
  bio?: string;
  app_version?: number;
}

interface RawRiffViewResponse {
  total_rows: number;
  offset: number;
  rows: Array<{ id: string; key: number | string; value: unknown }>;
}

interface RawAllDocsResponse {
  rows?: Array<{
    id?: string;
    key: string;
    value?: { rev?: string; deleted?: boolean };
    doc?: unknown;
    error?: string;
  }>;
}

export interface GetRiffIdsOptions {
  limit?: number;
  skip?: number;
  descending?: boolean;
}

export interface IterateRiffsOptions {
  pageSize?: number;
  descending?: boolean;
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

  async listJams(opts: { includeJoinable?: boolean } = {}): Promise<JamListing> {
    const session = await this.requireValidSession();
    const includeJoinable = opts.includeJoinable !== false;

    const subscribedPromise = this.getSubscribedJams();
    const joinablePromise = includeJoinable
      ? this.fetchJoinableJamIds(session)
      : Promise.resolve<string[]>([]);

    const [subscribedRows, joinableIds] = await Promise.all([subscribedPromise, joinablePromise]);

    const personal: JamRef = { jamId: session.userId, category: 'personal' };
    const subscribed: JamRef[] = subscribedRows.map((row) => ({
      jamId: row.jamId,
      category: 'subscribed',
      joinedAt: row.joinedAt,
    }));
    const joinable: JamRef[] = joinableIds.map((jamId) => ({
      jamId,
      category: 'joinable',
    }));
    return { personal, subscribed, joinable };
  }

  private async fetchJoinableJamIds(session: AuthSession): Promise<string[]> {
    const url = `${this.dataDomain}/app_client_config/bands:joinable`;
    const raw = await this.transport.request<{ band_ids?: string[] }>({
      url,
      method: 'GET',
      auth: { kind: 'basic', token: session.token, password: session.password },
    });
    return raw.band_ids ?? [];
  }

  async getRiffIds(
    jamId: string,
    opts: GetRiffIdsOptions = {},
  ): Promise<RiffIndex> {
    const session = await this.requireValidSession();
    const path = escapeCouchJamId(jamId);
    const query: string[] = [];
    if (opts.descending !== false) query.push('descending=true');
    if (opts.limit !== undefined) query.push(`limit=${opts.limit}`);
    if (opts.skip !== undefined) query.push(`skip=${opts.skip}`);
    const qs = query.length ? `?${query.join('&')}` : '';
    const url = `${this.dataDomain}/user_appdata$${path}/_design/types/_view/rifffLoopsByCreateTime${qs}`;

    const raw = await this.transport.request<RawRiffViewResponse>({
      url,
      method: 'GET',
      auth: { kind: 'basic', token: session.token, password: session.password },
    });

    const rows: RiffIndexRow[] = raw.rows.map((row) => {
      const stemIds: (StemCouchID | null)[] = [];
      const value = Array.isArray(row.value) ? row.value : [];
      for (let i = 0; i < 8; i++) {
        const v = value[i];
        stemIds.push(typeof v === 'string' && v !== '' ? (v as StemCouchID) : null);
      }
      return {
        riffId: row.id as RiffCouchID,
        createdAtNs: BigInt(row.key),
        stemIds,
      };
    });

    return { totalRows: raw.total_rows, rows };
  }

  async getRiffs(jamId: string, riffIds: string[]): Promise<RiffDocument[]> {
    if (riffIds.length === 0) return [];
    const session = await this.requireValidSession();
    const path = escapeCouchJamId(jamId);
    const url = `${this.dataDomain}/user_appdata$${path}/_all_docs?include_docs=true`;

    const raw = await this.transport.request<RawAllDocsResponse>({
      url,
      method: 'POST',
      body: { keys: riffIds },
      auth: { kind: 'basic', token: session.token, password: session.password },
    });

    const out: RiffDocument[] = [];
    for (const row of raw.rows ?? []) {
      if (row.error) continue;
      if (row.value && (row.value as { deleted?: boolean }).deleted) continue;
      if (!row.doc) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      out.push(parseRiffDocument(row.doc as any, jamId));
    }
    return out;
  }

  async getStemDocuments(
    jamId: string,
    stemIds: string[],
  ): Promise<(StemDocument | null)[]> {
    if (stemIds.length === 0) return [];
    const session = await this.requireValidSession();
    const path = escapeCouchJamId(jamId);
    const url = `${this.dataDomain}/user_appdata$${path}/_all_docs?include_docs=true`;

    const raw = await this.transport.request<RawAllDocsResponse>({
      url,
      method: 'POST',
      body: { keys: stemIds },
      auth: { kind: 'basic', token: session.token, password: session.password },
      responseTextTransform: applyLengthQuirk,
    });

    const rows = raw.rows ?? [];
    return rows.map((row) => {
      if (row.error) return null;
      if (row.value && (row.value as { deleted?: boolean }).deleted) return null;
      if (!row.doc) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return parseStemDocument(row.doc as any);
    });
  }

  async getStemUrls(
    jamId: string,
    riff: RiffDocument,
  ): Promise<(ResolvedStem | null)[]> {
    const activeStemIds = riff.slots.map((s) => (s.on ? s.stemId : null));
    const uniqueIds = Array.from(new Set(activeStemIds.filter((x): x is StemCouchID => !!x)));

    if (uniqueIds.length === 0) {
      return Array.from({ length: 8 }, () => null);
    }

    const docs = await this.getStemDocuments(jamId, uniqueIds);
    const byId = new Map<string, StemDocument>();
    for (let i = 0; i < uniqueIds.length; i++) {
      const doc = docs[i];
      if (doc) byId.set(uniqueIds[i]!, doc);
    }

    return activeStemIds.map((id) => {
      if (!id) return null;
      const doc = byId.get(id);
      if (!doc) return null;
      return resolveStemUrl(doc);
    });
  }

  async *iterateRiffs(
    jamId: string,
    opts: IterateRiffsOptions = {},
  ): AsyncGenerator<RiffDocument[], void, void> {
    const pageSize = opts.pageSize ?? 50;
    const descending = opts.descending !== false;
    let skip = 0;
    while (true) {
      const index = await this.getRiffIds(jamId, { limit: pageSize, skip, descending });
      if (index.rows.length === 0) return;
      const riffs = await this.getRiffs(
        jamId,
        index.rows.map((r) => r.riffId),
      );
      yield riffs;
      if (index.rows.length < pageSize) return;
      skip += index.rows.length;
    }
  }

  async getJam(jamId: string): Promise<JamProfile> {
    const session = await this.requireValidSession();
    const path = escapeCouchJamId(jamId);
    const url = `${this.dataDomain}/user_appdata$${path}/Profile`;

    const raw = await this.transport.request<RawJamProfile>({
      url,
      method: 'GET',
      auth: { kind: 'basic', token: session.token, password: session.password },
    });

    const profile: JamProfile = { jamId, displayName: raw.displayName };
    if (raw.bio !== undefined) profile.bio = raw.bio;
    if (raw.app_version !== undefined) profile.appVersion = raw.app_version;
    return profile;
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
// hyphens, so LORE escapes them as `(2d)`. The user-appdata path of the
// subscribed-jams view always uses the literal username, so always escape.
function escapeCouchUserName(name: string): string {
  return name.replace(/-/g, '(2d)');
}

// Jam IDs prefixed `band` are opaque CouchIDs and pass through unchanged.
// Anything else is a personal jam whose ID is the username and needs the same
// `-` → `(2d)` treatment. Mirrors LORE's checkAndSanitizeJamCouchID.
function escapeCouchJamId(jamId: string): string {
  if (jamId.startsWith('band')) return jamId;
  return escapeCouchUserName(jamId);
}
