export type AuthMode =
  | { kind: 'none' }
  | { kind: 'basic'; token: string; password: string }
  | { kind: 'bearer'; token: string; password: string };

export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  delayStepMs: number;
  maxDelayMs: number;
}

export interface LogEntry {
  method: string;
  url: string;
  attempt: number;
  status?: number;
  error?: unknown;
}

export interface HttpTransportOptions {
  fetch?: typeof fetch;
  userAgent?: string;
  retry?: Partial<RetryPolicy>;
  logger?: (entry: LogEntry) => void;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface TransportRequest {
  url: string;
  method: 'GET' | 'POST';
  body?: object | string;
  auth?: AuthMode;
  contentType?: string;
  // Optional transform applied to the response body text before JSON.parse.
  // Used for the Endlesss length-as-string quirk on stem documents.
  responseTextTransform?: (text: string) => string;
  // Suppress the LB=liveNN load-balancer cookie. The cookie is a routing
  // hint for the CouchDB cluster on data.endlesss.fm; sending it to other
  // tiers (notably api.endlesss.fm/auth/login) triggers 500s because the
  // upstream the cookie points at doesn't exist on that fleet.
  omitLoadBalancerCookie?: boolean;
}

export interface BinaryTransportRequest {
  url: string;
  method: 'GET' | 'POST';
  body?: object | string;
  auth?: AuthMode;
  // Accept header override; defaults to '*/*' for opaque binary responses.
  accept?: string;
  omitLoadBalancerCookie?: boolean;
}

// Mirrors LORE's NetConfiguration::attempt: 250ms, +150ms each retry, capped at 1s.
const DEFAULT_RETRY: RetryPolicy = {
  maxRetries: 3,
  initialDelayMs: 250,
  delayStepMs: 150,
  maxDelayMs: 1000,
};

export class HttpError extends Error {
  readonly name = 'HttpError';
  constructor(
    readonly status: number,
    readonly bodyText: string,
    readonly bodyJson: unknown,
    readonly url: string,
  ) {
    super(`HTTP ${status} ${url}`);
  }
}

export class NetworkError extends Error {
  readonly name = 'NetworkError';
  constructor(
    readonly cause: unknown,
    readonly attempts: number,
    readonly url: string,
  ) {
    super(`Network error after ${attempts} attempt(s): ${url}`);
  }
}

export class HttpTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly retry: RetryPolicy;
  private readonly logger?: (entry: LogEntry) => void;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: HttpTransportOptions = {}) {
    const fetchImpl = opts.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new Error('HttpTransport: no fetch implementation available');
    }
    this.fetchImpl = fetchImpl;
    this.userAgent = opts.userAgent ?? 'hoppper-sdk/0.1.0';
    this.retry = { ...DEFAULT_RETRY, ...opts.retry };
    this.logger = opts.logger;
    this.random = opts.random ?? Math.random;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async request<T = unknown>(req: TransportRequest): Promise<T> {
    const init: RequestInit = {
      method: req.method,
      headers: this.buildJsonHeaders(req),
    };
    if (req.body !== undefined) {
      init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const response = await this.attempt(req.url, req.method, init);
    const text = await response.text();
    if (!text) return undefined as T;
    const transformed = req.responseTextTransform ? req.responseTextTransform(text) : text;
    try {
      return JSON.parse(transformed) as T;
    } catch {
      throw new HttpError(response.status, text, null, req.url);
    }
  }

  async requestBinary(req: BinaryTransportRequest): Promise<Uint8Array> {
    const init: RequestInit = {
      method: req.method,
      headers: this.buildBinaryHeaders(req),
    };
    if (req.body !== undefined) {
      init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const response = await this.attempt(req.url, req.method, init);
    const buf = await response.arrayBuffer();
    return new Uint8Array(buf);
  }

  private async attempt(url: string, method: string, init: RequestInit): Promise<Response> {
    let attempt = 0;
    let delay = this.retry.initialDelayMs;

    while (true) {
      attempt++;

      let response: Response;
      try {
        response = await this.fetchImpl(url, init);
      } catch (error) {
        this.logger?.({ method, url, attempt, error });
        if (attempt - 1 >= this.retry.maxRetries) {
          throw new NetworkError(error, attempt, url);
        }
        await this.sleep(delay);
        delay = Math.min(delay + this.retry.delayStepMs, this.retry.maxDelayMs);
        continue;
      }

      this.logger?.({ method, url, attempt, status: response.status });

      if (response.status >= 200 && response.status < 300) {
        return response;
      }

      if (response.status >= 500 && attempt - 1 < this.retry.maxRetries) {
        await this.sleep(delay);
        delay = Math.min(delay + this.retry.delayStepMs, this.retry.maxDelayMs);
        continue;
      }

      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      throw new HttpError(response.status, text, parsed, url);
    }
  }

  private buildJsonHeaders(req: TransportRequest): Record<string, string> {
    const headers = this.buildBaseHeaders(req.omitLoadBalancerCookie);
    headers['Accept'] = 'application/json';
    headers['Accept-Language'] = 'en-gb';
    if (req.body !== undefined) {
      headers['Content-Type'] = req.contentType ?? 'application/json';
    }
    this.applyAuth(headers, req.auth);
    return headers;
  }

  private buildBinaryHeaders(req: BinaryTransportRequest): Record<string, string> {
    const headers = this.buildBaseHeaders(req.omitLoadBalancerCookie);
    headers['Accept'] = req.accept ?? '*/*';
    this.applyAuth(headers, req.auth);
    return headers;
  }

  private buildBaseHeaders(omitLoadBalancerCookie?: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      // Tauri's plugin-http auto-injects 'Origin: tauri://localhost' on every
      // request unless we set Origin ourselves. Endlesss's auth tier doesn't
      // recognise that scheme and 500s. With the 'unsafe-headers' feature
      // flag, an explicit empty Origin tells the plugin to drop the header
      // entirely — matching how LORE's httplib client behaves (no Origin).
      Origin: '',
    };
    if (!omitLoadBalancerCookie) {
      headers['Cookie'] = this.loadBalancerCookie();
    }
    return headers;
  }

  private applyAuth(headers: Record<string, string>, auth: AuthMode | undefined): void {
    if (auth?.kind === 'basic') {
      headers['Authorization'] = `Basic ${encodeBase64(`${auth.token}:${auth.password}`)}`;
    } else if (auth?.kind === 'bearer') {
      headers['Authorization'] = `Bearer ${auth.token}:${auth.password}`;
    }
  }

  private loadBalancerCookie(): string {
    const r = this.random();
    const clamped = r < 0 ? 0 : r >= 1 ? 0.999999 : r;
    const idx = 1 + Math.floor(clamped * 7);
    return `LB=live${idx.toString().padStart(2, '0')}`;
  }
}

function encodeBase64(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf8').toString('base64');
  }
  return btoa(unescape(encodeURIComponent(input)));
}
