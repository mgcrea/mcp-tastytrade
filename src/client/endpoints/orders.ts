import type { TastytradeHttpClient } from "../http.js";

export type OrdersQuery = {
  perPage?: number;
  pageOffset?: number;
  startDate?: string;
  endDate?: string;
  futuresSymbol?: string;
  underlyingSymbol?: string;
  status?: string[];
  underlyingInstrumentType?: string;
  sort?: "Desc" | "Asc";
};

export type OrderLeg = {
  instrumentType: string;
  symbol: string;
  quantity: number;
  action: "Buy to Open" | "Buy to Close" | "Sell to Open" | "Sell to Close" | "Buy" | "Sell";
};

export type OrderRequest = {
  timeInForce: "Day" | "GTC" | "GTD" | "IOC";
  gtcDate?: string;
  orderType: "Limit" | "Market" | "Marketable Limit" | "Stop" | "Stop Limit" | "Notional Market";
  stopTrigger?: number;
  price?: number;
  priceEffect?: "Debit" | "Credit";
  value?: number;
  valueEffect?: "Debit" | "Credit";
  source?: string;
  legs: OrderLeg[];
  rules?: unknown;
};

export const listOrders = (
  http: TastytradeHttpClient,
  accountNumber: string,
  query?: OrdersQuery,
): Promise<{ items: unknown[] }> =>
  http.get(`/accounts/${encodeURIComponent(accountNumber)}/orders`, { query });

export const getOrder = (
  http: TastytradeHttpClient,
  accountNumber: string,
  orderId: string | number,
): Promise<unknown> =>
  http.get(
    `/accounts/${encodeURIComponent(accountNumber)}/orders/${encodeURIComponent(String(orderId))}`,
  );

export const dryRunOrder = (
  http: TastytradeHttpClient,
  accountNumber: string,
  body: OrderRequest,
): Promise<unknown> =>
  http.post(`/accounts/${encodeURIComponent(accountNumber)}/orders/dry-run`, body);

export const placeOrder = (
  http: TastytradeHttpClient,
  accountNumber: string,
  body: OrderRequest,
): Promise<unknown> => http.post(`/accounts/${encodeURIComponent(accountNumber)}/orders`, body);

export const cancelOrder = (
  http: TastytradeHttpClient,
  accountNumber: string,
  orderId: string | number,
): Promise<unknown> =>
  http.delete(
    `/accounts/${encodeURIComponent(accountNumber)}/orders/${encodeURIComponent(String(orderId))}`,
  );

export const replaceOrder = (
  http: TastytradeHttpClient,
  accountNumber: string,
  orderId: string | number,
  body: OrderRequest,
): Promise<unknown> =>
  http.put(
    `/accounts/${encodeURIComponent(accountNumber)}/orders/${encodeURIComponent(String(orderId))}`,
    body,
  );
