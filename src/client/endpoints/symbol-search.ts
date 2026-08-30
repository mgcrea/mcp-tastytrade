import type { TastytradeHttpClient } from "#/client/http";

export const searchSymbols = (
  http: TastytradeHttpClient,
  prefix: string,
): Promise<{ items: unknown[] }> => http.get(`/symbols/search/${encodeURIComponent(prefix)}`);
