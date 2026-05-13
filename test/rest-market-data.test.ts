import { describe, expect, it, vi } from "vitest";

import { TastytradeHttpClient } from "../src/client/http.js";
import { RestMarketDataProvider } from "../src/streaming/rest-market-data.js";

const tokenResponse = new Response(JSON.stringify({ access_token: "t", expires_in: 900 }), {
  status: 200,
  headers: { "content-type": "application/json" },
});

const buildClient = (
  responder: (url: string) => Response,
): { http: TastytradeHttpClient; calls: string[] } => {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : (input as URL | Request).toString();
    if (url.includes("/oauth/token")) return tokenResponse.clone();
    calls.push(url);
    return responder(url);
  }) as unknown as typeof fetch;
  const http = new TastytradeHttpClient({
    baseUrl: "https://api.example.com",
    oauth: { clientSecret: "s", refreshToken: "r", scope: "read" },
    fetch: fetchImpl,
  });
  return { http, calls };
};

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("RestMarketDataProvider", () => {
  it("fetches equity quotes and maps fields", async () => {
    const { http, calls } = buildClient(() =>
      jsonResponse({
        data: {
          items: [
            {
              symbol: "AAPL",
              "instrument-type": "Equity",
              bid: "150.25",
              ask: "150.27",
              mark: "150.26",
              "bid-size": 100,
              "ask-size": 200,
              "updated-at": "2026-05-13T14:32:15Z",
            },
          ],
        },
      }),
    );
    const provider = new RestMarketDataProvider(http);
    const out = await provider.snapshot(["AAPL"]);

    expect(out).toHaveLength(1);
    expect(out[0]?.symbol).toBe("AAPL");
    expect(out[0]?.quote?.bidPrice).toBe(150.25);
    expect(out[0]?.quote?.askPrice).toBe(150.27);
    expect(out[0]?.quote?.bidSize).toBe(100);
    expect(out[0]?.quote?.askSize).toBe(200);
    expect(out[0]?.quote?.eventTimeIso).toBe("2026-05-13T14:32:15Z");
    expect(out[0]?.greeks).toBeNull();

    expect(calls[0]).toContain("/market-data/by-type");
    expect(decodeURIComponent(calls[0] ?? "")).toContain("equity=AAPL");
  });

  it("routes a DXLink-format option to OCC for the REST call", async () => {
    const { http, calls } = buildClient(() =>
      jsonResponse({
        data: {
          items: [
            {
              symbol: "IWM   260529C00300000",
              "instrument-type": "Equity Option",
              bid: 1.0,
              ask: 1.2,
            },
          ],
        },
      }),
    );
    const provider = new RestMarketDataProvider(http);
    const [snap] = await provider.snapshot([".IWM260529C300"]);

    expect(snap?.symbol).toBe(".IWM260529C300");
    expect(snap?.dxlinkSymbol).toBe(".IWM260529C300");
    expect(snap?.quote?.bidPrice).toBe(1.0);
    expect(snap?.greeks).toBeNull();
    // Spaces in option symbols are encoded as %20 (not +) for stricter parsers.
    expect(calls[0]).toContain("equity-option=IWM%20%20%20260529C00300000");
  });

  it("preserves input order even when REST reorders the response", async () => {
    const { http } = buildClient(() =>
      jsonResponse({
        data: {
          items: [
            { symbol: "SPY", bid: 580, ask: 580.1 },
            { symbol: "AAPL", bid: 150, ask: 150.1 },
          ],
        },
      }),
    );
    const provider = new RestMarketDataProvider(http);
    const out = await provider.snapshot(["AAPL", "SPY"]);

    expect(out.map((s) => s.symbol)).toEqual(["AAPL", "SPY"]);
    expect(out[0]?.quote?.bidPrice).toBe(150);
    expect(out[1]?.quote?.bidPrice).toBe(580);
  });

  it("chunks requests at 100 symbols", async () => {
    let requestCount = 0;
    const { http } = buildClient(() => {
      requestCount += 1;
      return jsonResponse({ data: { items: [] } });
    });
    const provider = new RestMarketDataProvider(http);
    const many = Array.from({ length: 150 }, (_, i) => `SYM${i}`);
    await provider.snapshot(many);
    expect(requestCount).toBe(2);
  });

  it("returns quote=null when the row is missing from the response", async () => {
    const { http } = buildClient(() => jsonResponse({ data: { items: [] } }));
    const provider = new RestMarketDataProvider(http);
    const [snap] = await provider.snapshot(["XYZZY"]);
    expect(snap?.quote).toBeNull();
    expect(snap?.greeks).toBeNull();
  });

  it("classifies cryptocurrency symbols separately", async () => {
    const { http, calls } = buildClient(() =>
      jsonResponse({ data: { items: [{ symbol: "BTC/USD", bid: 60000, ask: 60001 }] } }),
    );
    const provider = new RestMarketDataProvider(http);
    await provider.snapshot(["BTC/USD"]);
    expect(decodeURIComponent(calls[0] ?? "")).toContain("cryptocurrency=BTC/USD");
  });

  it("reports diagnostics including mode and request counters", async () => {
    const { http } = buildClient(() => jsonResponse({ data: { items: [] } }));
    const provider = new RestMarketDataProvider(http);
    expect(provider.mode).toBe("rest");
    expect(provider.getDiagnostics()).toMatchObject({
      mode: "rest",
      totalRequests: 0,
      lastRequestAt: null,
    });
    await provider.snapshot(["AAPL", "SPY"]);
    const diag = provider.getDiagnostics();
    expect(diag.totalRequests).toBe(1);
    expect(diag.lastRequestCount).toBe(2);
    expect(typeof diag.lastRequestAt).toBe("string");
  });

  it("handles empty input without making a request", async () => {
    const { http, calls } = buildClient(() => jsonResponse({ data: { items: [] } }));
    const provider = new RestMarketDataProvider(http);
    const out = await provider.snapshot([]);
    expect(out).toEqual([]);
    expect(calls).toEqual([]);
  });
});
