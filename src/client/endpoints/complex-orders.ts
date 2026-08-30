import type { OrderRequest } from "#/client/endpoints/orders";
import type { TastytradeHttpClient } from "#/client/http";

export type ComplexOrderRequest = {
  type: "OTOCO" | "OCO" | "OTO";
  triggerOrder?: OrderRequest;
  orders: OrderRequest[];
};

export const dryRunComplexOrder = (
  http: TastytradeHttpClient,
  accountNumber: string,
  body: ComplexOrderRequest,
): Promise<unknown> =>
  http.post(`/accounts/${encodeURIComponent(accountNumber)}/complex-orders/dry-run`, body);

export const placeComplexOrder = (
  http: TastytradeHttpClient,
  accountNumber: string,
  body: ComplexOrderRequest,
): Promise<unknown> =>
  http.post(`/accounts/${encodeURIComponent(accountNumber)}/complex-orders`, body);

export const getComplexOrder = (
  http: TastytradeHttpClient,
  accountNumber: string,
  orderId: string | number,
): Promise<unknown> =>
  http.get(
    `/accounts/${encodeURIComponent(accountNumber)}/complex-orders/${encodeURIComponent(String(orderId))}`,
  );

export const cancelComplexOrder = (
  http: TastytradeHttpClient,
  accountNumber: string,
  orderId: string | number,
): Promise<unknown> =>
  http.delete(
    `/accounts/${encodeURIComponent(accountNumber)}/complex-orders/${encodeURIComponent(String(orderId))}`,
  );
