import type { TastytradeHttpClient } from "../http.js";

export const getBalances = (http: TastytradeHttpClient, accountNumber: string): Promise<unknown> =>
  http.get(`/accounts/${encodeURIComponent(accountNumber)}/balances`);

export const getBalanceSnapshots = (
  http: TastytradeHttpClient,
  accountNumber: string,
  query?: { snapshotDate?: string; timeOfDay?: "BOD" | "EOD" },
): Promise<unknown> =>
  http.get(`/accounts/${encodeURIComponent(accountNumber)}/balance-snapshots`, { query });
