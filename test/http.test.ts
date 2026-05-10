import { beforeEach, describe, expect, it, vi } from "vitest";
import { TastytradeApiError } from "../src/client/errors.js";
import { TastytradeHttpClient } from "../src/client/http.js";

type MockCall = { url: string; init: RequestInit };

const makeMockFetch = (handler: (call: MockCall) => Response | Promise<Response>) => {
  const calls: MockCall[] = [];
  const fn = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    const call: MockCall = { url: String(url), init };
    calls.push(call);
    return handler(call);
  });
  return { fn: fn as unknown as typeof fetch, calls };
};

const tokenResponse = (accessToken: string, expiresIn = 900) =>
  new Response(
    JSON.stringify({ access_token: accessToken, expires_in: expiresIn, token_type: "Bearer" }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

describe("TastytradeHttpClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  it("refreshes token on first request and sends Bearer auth", async () => {
    const { fn, calls } = makeMockFetch((call) => {
      if (call.url.endsWith("/oauth/token")) return tokenResponse("acc-1");
      return jsonResponse({ data: { items: [{ accountNumber: "5WX" }] } });
    });
    const http = new TastytradeHttpClient({
      baseUrl: "https://api.example.com",
      oauth: { clientSecret: "sec", refreshToken: "ref", scope: "read" },
      fetch: fn,
    });
    const result = await http.get<{ items: { accountNumber: string }[] }>("/customers/me/accounts");
    expect(result).toEqual({ items: [{ accountNumber: "5WX" }] });
    expect(calls[0]?.url).toBe("https://api.example.com/oauth/token");
    expect(calls[0]?.init.body).toContain("grant_type=refresh_token");
    const apiCall = calls[1];
    expect(apiCall).toBeDefined();
    expect((apiCall!.init.headers as Record<string, string>).Authorization).toBe("Bearer acc-1");
  });

  it("retries once with a refreshed token on 401", async () => {
    let apiCallCount = 0;
    const { fn } = makeMockFetch((call) => {
      if (call.url.endsWith("/oauth/token")) {
        return tokenResponse(`acc-${++tokenIssued}`);
      }
      apiCallCount += 1;
      if (apiCallCount === 1) return new Response("{}", { status: 401 });
      return jsonResponse({ data: { ok: true } });
    });
    let tokenIssued = 0;
    const http = new TastytradeHttpClient({
      baseUrl: "https://api.example.com",
      oauth: { clientSecret: "sec", refreshToken: "ref", scope: "read" },
      fetch: fn,
    });
    const result = await http.get<{ ok: boolean }>("/anything");
    expect(result).toEqual({ ok: true });
    expect(apiCallCount).toBe(2);
    expect(tokenIssued).toBe(2);
  });

  it("transforms request bodies to kebab-case and responses to camelCase", async () => {
    const { fn, calls } = makeMockFetch((call) => {
      if (call.url.endsWith("/oauth/token")) return tokenResponse("t");
      return jsonResponse({ data: { "account-number": "5WX", "buying-power": 1000 } });
    });
    const http = new TastytradeHttpClient({
      baseUrl: "https://api.example.com",
      oauth: { clientSecret: "sec", refreshToken: "ref", scope: "read" },
      fetch: fn,
    });
    const result = await http.post<{ accountNumber: string; buyingPower: number }>("/x", {
      timeInForce: "GTC",
      orderType: "Limit",
    });
    expect(result).toEqual({ accountNumber: "5WX", buyingPower: 1000 });
    const body = JSON.parse(String(calls[1]?.init.body)) as Record<string, string>;
    expect(body).toEqual({ "time-in-force": "GTC", "order-type": "Limit" });
  });

  it("throws TastytradeApiError on 4xx with the API error message", async () => {
    const { fn } = makeMockFetch((call) => {
      if (call.url.endsWith("/oauth/token")) return tokenResponse("t");
      return jsonResponse({ error: { message: "Invalid symbol", code: "validation_error" } }, 422);
    });
    const http = new TastytradeHttpClient({
      baseUrl: "https://api.example.com",
      oauth: { clientSecret: "sec", refreshToken: "ref", scope: "read" },
      fetch: fn,
    });
    await expect(http.get("/x")).rejects.toMatchObject({
      name: "TastytradeApiError",
      status: 422,
      message: "Invalid symbol",
      code: "validation_error",
    });
  });

  it("encodes array query params with [] suffix", async () => {
    const { fn, calls } = makeMockFetch((call) => {
      if (call.url.endsWith("/oauth/token")) return tokenResponse("t");
      return jsonResponse({ data: { items: [] } });
    });
    const http = new TastytradeHttpClient({
      baseUrl: "https://api.example.com",
      oauth: { clientSecret: "sec", refreshToken: "ref", scope: "read" },
      fetch: fn,
    });
    await http.get("/accounts/5WX/positions", { query: { underlyingSymbol: ["AAPL", "TSLA"] } });
    const apiCall = calls[1];
    expect(apiCall?.url).toContain("underlying-symbol%5B%5D=AAPL");
    expect(apiCall?.url).toContain("underlying-symbol%5B%5D=TSLA");
  });
});

describe("TastytradeApiError", () => {
  it("captures status, code, and body", () => {
    const e = new TastytradeApiError("nope", { status: 500, code: "x", body: { y: 1 } });
    expect(e.status).toBe(500);
    expect(e.code).toBe("x");
    expect(e.body).toEqual({ y: 1 });
  });
});
