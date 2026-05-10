import type { TastytradeHttpClient } from "../http.js";

export const searchSymbols = (
  http: TastytradeHttpClient,
  prefix: string,
): Promise<{ items: unknown[] }> => http.get(`/symbols/search/${encodeURIComponent(prefix)}`);
