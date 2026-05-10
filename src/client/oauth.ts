import { TastytradeApiError } from "./errors.js";

export type OAuthCredentials = {
  clientSecret: string;
  refreshToken: string;
  scope: string;
};

type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type?: string;
};

export class AccessToken {
  private value: string | null = null;
  private expiresAt = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly creds: OAuthCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly userAgent = "mcp-tastytrade",
  ) {}

  get isFresh(): boolean {
    return this.value !== null && Date.now() < this.expiresAt - 30_000;
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
      throw new TastytradeApiError(`OAuth token refresh failed (${res.status})`, {
        status: res.status,
        body: text,
      });
    }
    const data = (await res.json()) as TokenResponse;
    this.value = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    return this.value;
  }
}
