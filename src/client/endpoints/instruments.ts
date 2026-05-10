import type { TastytradeHttpClient } from "../http.js";

export const getEquity = (http: TastytradeHttpClient, symbol: string): Promise<unknown> =>
  http.get(`/instruments/equities/${encodeURIComponent(symbol)}`);

export const listEquities = (
  http: TastytradeHttpClient,
  query?: { symbol?: string[]; lendability?: string; isIndex?: boolean; isEtf?: boolean },
): Promise<{ items: unknown[] }> => http.get("/instruments/equities", { query });

export const getEquityOption = (
  http: TastytradeHttpClient,
  symbol: string,
  query?: { active?: boolean },
): Promise<unknown> =>
  http.get(`/instruments/equity-options/${encodeURIComponent(symbol)}`, { query });

export const getOptionChainNested = (
  http: TastytradeHttpClient,
  underlyingSymbol: string,
): Promise<{ items: unknown[] }> =>
  http.get(`/option-chains/${encodeURIComponent(underlyingSymbol)}/nested`);

export const getOptionChainCompact = (
  http: TastytradeHttpClient,
  underlyingSymbol: string,
): Promise<{ items: unknown[] }> =>
  http.get(`/option-chains/${encodeURIComponent(underlyingSymbol)}/compact`);

export const getFuture = (http: TastytradeHttpClient, symbol: string): Promise<unknown> =>
  http.get(`/instruments/futures/${encodeURIComponent(symbol)}`);

export const listFutures = (
  http: TastytradeHttpClient,
  query?: { symbol?: string[]; productCode?: string[] },
): Promise<{ items: unknown[] }> => http.get("/instruments/futures", { query });

export const getFutureOptionChainNested = (
  http: TastytradeHttpClient,
  productCode: string,
): Promise<unknown> => http.get(`/futures-option-chains/${encodeURIComponent(productCode)}/nested`);

export const getCryptocurrency = (http: TastytradeHttpClient, symbol: string): Promise<unknown> =>
  http.get(`/instruments/cryptocurrencies/${encodeURIComponent(symbol)}`);

export const listCryptocurrencies = (
  http: TastytradeHttpClient,
  query?: { symbol?: string[] },
): Promise<{ items: unknown[] }> => http.get("/instruments/cryptocurrencies", { query });
