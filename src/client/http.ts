import { toCamelKeys, toKebabKeys } from "../lib/case.js";
import { TastytradeApiError } from "./errors.js";
import { AccessToken, type OAuthCredentials } from "./oauth.js";

export type Logger = {
  debug?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
};

export type HttpClientOptions = {
  baseUrl: string;
  oauth: OAuthCredentials;
  fetch?: typeof fetch;
  logger?: Logger;
  userAgent?: string;
};

export type RequestOptions = {
  query?: Record<string, unknown>;
  body?: unknown;
  version?: string;
  signal?: AbortSignal;
};

const buildQuery = (query: Record<string, unknown> | undefined): string => {
  if (!query) return "";
  const params = new URLSearchParams();
  const kebab = toKebabKeys(query) as Record<string, unknown>;
  for (const [key, value] of Object.entries(kebab)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v !== undefined && v !== null) params.append(`${key}[]`, String(v));
      }
    } else {
      params.append(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
};

export class TastytradeHttpClient {
  private readonly baseUrl: string;
  private readonly token: AccessToken;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger | undefined;
  private readonly userAgent: string;

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? fetch;
    this.logger = opts.logger;
    this.userAgent = opts.userAgent ?? "mcp-tastytrade/0.1.0";
    this.token = new AccessToken(this.baseUrl, opts.oauth, this.fetchImpl);
  }

  get accessToken(): AccessToken {
    return this.token;
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${path}${buildQuery(opts.query)}`;
    const send = async (forceRefresh: boolean): Promise<Response> => {
      if (forceRefresh) this.token.invalidate();
      const accessToken = await this.token.get();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": this.userAgent,
      };
      if (opts.version) headers["Accept-Version"] = opts.version;
      let body: string | undefined;
      if (opts.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(toKebabKeys(opts.body));
      }
      this.logger?.debug?.(`[tastytrade] ${method} ${url}`);
      const init: RequestInit = { method, headers };
      if (body !== undefined) init.body = body;
      if (opts.signal) init.signal = opts.signal;
      return this.fetchImpl(url, init);
    };

    let res = await send(false);
    if (res.status === 401) {
      this.logger?.warn?.("[tastytrade] 401 — refreshing access token and retrying once");
      res = await send(true);
    }

    const text = await res.text();
    const json = text ? safeJsonParse(text) : undefined;

    if (!res.ok) {
      const errorBody = json as { error?: { message?: string; code?: string } } | undefined;
      const message = errorBody?.error?.message ?? `Tastytrade API error ${res.status}`;
      throw new TastytradeApiError(message, {
        status: res.status,
        ...(errorBody?.error?.code !== undefined ? { code: errorBody.error.code } : {}),
        body: json ?? text,
      });
    }

    if (json === undefined) return undefined as T;
    const camel = toCamelKeys(json) as { data?: T } & T;
    return (camel.data ?? camel) as T;
  }

  get<T>(path: string, opts: Omit<RequestOptions, "body"> = {}): Promise<T> {
    return this.request<T>("GET", path, opts);
  }
  post<T>(path: string, body?: unknown, opts: Omit<RequestOptions, "body"> = {}): Promise<T> {
    return this.request<T>("POST", path, { ...opts, body });
  }
  put<T>(path: string, body?: unknown, opts: Omit<RequestOptions, "body"> = {}): Promise<T> {
    return this.request<T>("PUT", path, { ...opts, body });
  }
  patch<T>(path: string, body?: unknown, opts: Omit<RequestOptions, "body"> = {}): Promise<T> {
    return this.request<T>("PATCH", path, { ...opts, body });
  }
  delete<T>(path: string, opts: Omit<RequestOptions, "body"> = {}): Promise<T> {
    return this.request<T>("DELETE", path, opts);
  }
}

const safeJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
