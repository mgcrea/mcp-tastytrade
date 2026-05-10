import type { TastytradeHttpClient } from "../http.js";

export type QuoteToken = {
  token: string;
  dxlinkUrl: string;
  level?: string;
};

export const getApiQuoteToken = (http: TastytradeHttpClient): Promise<QuoteToken> =>
  http.get("/api-quote-tokens");
