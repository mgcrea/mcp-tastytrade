import type { TastytradeHttpClient } from "../http.js";

export const getMarketMetrics = (
  http: TastytradeHttpClient,
  symbols: string[],
): Promise<{ items: unknown[] }> =>
  http.get("/market-metrics", { query: { symbols: symbols.join(",") } });

export const getDividendHistory = (
  http: TastytradeHttpClient,
  symbol: string,
): Promise<{ items: unknown[] }> =>
  http.get(`/market-metrics/historic-corporate-events/dividends/${encodeURIComponent(symbol)}`);

export const getEarningsHistory = (
  http: TastytradeHttpClient,
  symbol: string,
): Promise<{ items: unknown[] }> =>
  http.get(
    `/market-metrics/historic-corporate-events/earnings-reports/${encodeURIComponent(symbol)}`,
  );
