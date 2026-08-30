import type { TastytradeHttpClient } from "#/client/http";

export type QuoteToken = {
  token: string;
  dxlinkUrl: string;
  level?: string;
};

export const getApiQuoteToken = (http: TastytradeHttpClient): Promise<QuoteToken> =>
  http.get("/api-quote-tokens");
