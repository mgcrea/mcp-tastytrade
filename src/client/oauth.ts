import { TastytradeApiError } from "./errors.js";

export type OAuthCredentials = {
  clientSecret: string;
  refreshToken: string;
  scope: string;
};

export type AccessTokenLogger = {
  debug?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
};

type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type?: string;
};

export class AccessToken {
  private value: string | null = null;
  private expiresAt = 0;
  private refreshCount = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly creds: OAuthCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly userAgent = "mcp-tastytrade",
    private readonly logger: AccessTokenLogger = {},
  ) {}

  get isFresh(): boolean {
    return this.value !== null && Date.now() < this.expiresAt - 30_000;
  }

  // Surface a sanitized snapshot for diagnostics — never the token value itself.
  info(): {
    hasToken: boolean;
    isFresh: boolean;
    expiresAt: string | null;
    refreshCount: number;
  } {
    return {
      hasToken: this.value !== null,
      isFresh: this.isFresh,
      expiresAt: this.expiresAt > 0 ? new Date(this.expiresAt).toISOString() : null,
      refreshCount: this.refreshCount,
    };
  }

  invalidate(): void {
    this.value = null;
    this.expiresAt = 0;
  }

  async get(): Promise<string> {
    if (this.isFresh && this.value !== null) {
      return this.value;
    }
    return this.refresh();
  }

  async refresh(): Promise<string> {
    this.logger.debug?.(`oauth: refreshing access token (scope="${this.creds.scope}")`);
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.creds.refreshToken,
      client_secret: this.creds.clientSecret,
      scope: this.creds.scope,
    });
    const res = await this.fetchImpl(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": this.userAgent,
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      this.logger.warn?.(`oauth: refresh failed status=${res.status} body=${text}`);
      throw new TastytradeApiError(`OAuth token refresh failed (${res.status})`, {
        status: res.status,
        body: text,
      });
    }
    const data = (await res.json()) as TokenResponse;
    this.value = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    this.refreshCount += 1;
    this.logger.debug?.(
      `oauth: refreshed (expires_in=${data.expires_in}s, count=${this.refreshCount})`,
    );
    return this.value;
  }
}
