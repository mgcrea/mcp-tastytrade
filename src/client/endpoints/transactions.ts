import type { TastytradeHttpClient } from "../http.js";

export type TransactionsQuery = {
  perPage?: number;
  pageOffset?: number;
  sort?: "Desc" | "Asc";
  type?: string;
  types?: string[];
  subType?: string[];
  startDate?: string;
  endDate?: string;
  startAt?: string;
  endAt?: string;
  symbol?: string;
  underlyingSymbol?: string;
  instrumentType?: string;
  futuresSymbol?: string;
  action?: string;
  partitionKey?: string;
};

export const listTransactions = (
  http: TastytradeHttpClient,
  accountNumber: string,
  query?: TransactionsQuery,
): Promise<{ items: unknown[] }> =>
  http.get(`/accounts/${encodeURIComponent(accountNumber)}/transactions`, { query });

export const getTransaction = (
  http: TastytradeHttpClient,
  accountNumber: string,
  id: string | number,
): Promise<unknown> =>
  http.get(
    `/accounts/${encodeURIComponent(accountNumber)}/transactions/${encodeURIComponent(String(id))}`,
  );
