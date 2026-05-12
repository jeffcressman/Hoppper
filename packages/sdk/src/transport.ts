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
    let attempt = 0;
    let delay = this.retry.initialDelayMs;

    while (true) {
      attempt++;

      const init: RequestInit = {
        method: req.method,
        headers: this.buildHeaders(req),
      };
      if (req.body !== undefined) {
        init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      }

      let response: Response;
      try {
        response = await this.fetchImpl(req.url, init);
      } catch (error) {
        this.logger?.({ method: req.method, url: req.url, attempt, error });
        if (attempt - 1 >= this.retry.maxRetries) {
          throw new NetworkError(error, attempt, req.url);
        }
        await this.sleep(delay);
        delay = Math.min(delay + this.retry.delayStepMs, this.retry.maxDelayMs);
        continue;
      }

      this.logger?.({ method: req.method, url: req.url, attempt, status: response.status });

      if (response.status >= 200 && response.status < 300) {
        const text = await response.text();
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new HttpError(response.status, text, null, req.url);
        }
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
      throw new HttpError(response.status, text, parsed, req.url);
    }
  }

  private buildHeaders(req: TransportRequest): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Accept-Language': 'en-gb',
      'User-Agent': this.userAgent,
      Cookie: this.loadBalancerCookie(),
    };
    if (req.body !== undefined) {
      headers['Content-Type'] = req.contentType ?? 'application/json';
    }
    const auth = req.auth;
    if (auth?.kind === 'basic') {
      headers['Authorization'] = `Basic ${encodeBase64(`${auth.token}:${auth.password}`)}`;
    } else if (auth?.kind === 'bearer') {
      headers['Authorization'] = `Bearer ${auth.token}:${auth.password}`;
    }
    return headers;
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
