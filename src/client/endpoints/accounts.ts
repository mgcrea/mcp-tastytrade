import type { TastytradeHttpClient } from "../http.js";

export type CustomerAccount = {
  account: { accountNumber: string; nickname?: string; accountTypeName?: string };
  authorityLevel?: string;
};

export const listAccounts = (http: TastytradeHttpClient): Promise<{ items: CustomerAccount[] }> =>
  http.get("/customers/me/accounts");

export const getAccount = (http: TastytradeHttpClient, accountNumber: string): Promise<unknown> =>
  http.get(`/customers/me/accounts/${encodeURIComponent(accountNumber)}`);

export const getCustomer = (http: TastytradeHttpClient): Promise<unknown> =>
  http.get("/customers/me");
