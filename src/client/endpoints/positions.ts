import type { TastytradeHttpClient } from "../http.js";

export type PositionsQuery = {
  underlyingSymbol?: string[];
  symbol?: string;
  instrumentType?: string;
  includeClosedPositions?: boolean;
  underlyingProductCode?: string;
  partitionKeys?: string[];
  netPositions?: boolean;
  includeMarks?: boolean;
};

export const getPositions = (
  http: TastytradeHttpClient,
  accountNumber: string,
  query?: PositionsQuery,
): Promise<{ items: unknown[] }> =>
  http.get(`/accounts/${encodeURIComponent(accountNumber)}/positions`, { query });
