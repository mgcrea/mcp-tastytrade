import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  cancelOrder,
  dryRunOrder,
  getOrder,
  listOrders,
  type OrderRequest,
  placeOrder,
  replaceOrder,
} from "../client/endpoints/orders.js";
import type { TastytradeHttpClient } from "../client/http.js";
import { wrap } from "./util.js";

const OrderLegSchema = z.object({
  instrumentType: z.string().describe('e.g. "Equity", "Equity Option", "Future", "Future Option"'),
  symbol: z.string(),
  quantity: z.number().positive(),
  action: z.enum(["Buy to Open", "Buy to Close", "Sell to Open", "Sell to Close", "Buy", "Sell"]),
});

const OrderRequestSchema = z.object({
  timeInForce: z.enum(["Day", "GTC", "GTD", "IOC"]),
  gtcDate: z.string().optional(),
  orderType: z.enum([
    "Limit",
    "Market",
    "Marketable Limit",
    "Stop",
    "Stop Limit",
    "Notional Market",
  ]),
  stopTrigger: z.number().optional(),
  price: z.number().optional(),
  priceEffect: z.enum(["Debit", "Credit"]).optional(),
  value: z.number().optional(),
  valueEffect: z.enum(["Debit", "Credit"]).optional(),
  source: z.string().optional(),
  legs: z.array(OrderLegSchema).min(1).max(4),
});

export const registerOrderReadTools = (server: McpServer, http: TastytradeHttpClient): void => {
  server.tool(
    "list_orders",
    "List orders for an account, optionally filtered by status / date range.",
    {
      accountNumber: z.string(),
      perPage: z.number().int().positive().max(2000).optional(),
      pageOffset: z.number().int().nonnegative().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      status: z.array(z.string()).optional(),
      underlyingSymbol: z.string().optional(),
      sort: z.enum(["Desc", "Asc"]).optional(),
    },
    async ({ accountNumber, ...query }) => wrap(() => listOrders(http, accountNumber, query)),
  );

  server.tool(
    "get_order",
    "Get a single order by id.",
    { accountNumber: z.string(), orderId: z.union([z.string(), z.number()]) },
    async ({ accountNumber, orderId }) => wrap(() => getOrder(http, accountNumber, orderId)),
  );
};

export const registerOrderWriteTools = (
  server: McpServer,
  http: TastytradeHttpClient,
  skipConfirm = false,
): void => {
  const placeDescription = skipConfirm
    ? "Submit an order. TASTYTRADE_DANGEROUSLY_ALLOW_TRADING=1 is set — calls submit by default. Pass confirm=false to force a dry-run preview instead."
    : "Submit an order. Call with confirm=false (default) to validate without submitting — returns TastyTrade's dry-run preview (BP effect, fees, warnings). Call with confirm=true to actually submit.";

  server.tool(
    "place_order",
    placeDescription,
    {
      accountNumber: z.string(),
      order: OrderRequestSchema,
      confirm: z
        .boolean()
        .default(skipConfirm)
        .describe(
          skipConfirm
            ? "true (default with DANGEROUSLY flag) submits; false forces a dry-run preview."
            : "false (default) returns a dry-run preview; true submits the order.",
        ),
    },
    async ({ accountNumber, order, confirm }) =>
      wrap(async () => {
        if (!confirm) {
          const preview = await dryRunOrder(http, accountNumber, order as OrderRequest);
          return {
            submitted: false,
            message: "Dry-run preview only. Re-call with confirm=true to submit this order.",
            preview,
          };
        }
        const submitted = await placeOrder(http, accountNumber, order as OrderRequest);
        return { submitted: true, result: submitted };
      }),
  );

  server.tool(
    "cancel_order",
    skipConfirm
      ? "Cancel an open order. TASTYTRADE_DANGEROUSLY_ALLOW_TRADING=1 is set — cancels immediately by default."
      : "Cancel an open order.",
    {
      accountNumber: z.string(),
      orderId: z.union([z.string(), z.number()]),
      confirm: z.boolean().default(skipConfirm),
    },
    async ({ accountNumber, orderId, confirm }) =>
      wrap(async () => {
        if (!confirm) {
          return {
            cancelled: false,
            message: "Re-call with confirm=true to cancel order " + String(orderId) + ".",
          };
        }
        const result = await cancelOrder(http, accountNumber, orderId);
        return { cancelled: true, result };
      }),
  );

  server.tool(
    "cancel_all_orders",
    skipConfirm
      ? "Cancel every open order on an account (optionally filtered by underlyingSymbol). TASTYTRADE_DANGEROUSLY_ALLOW_TRADING=1 is set — cancels immediately by default. Pass confirm=false to force a dry-run preview. Returns {cancelled, failed} on submit; partial failures are reported per order."
      : "Cancel every open order on an account (optionally filtered by underlyingSymbol). Call with confirm=false (default) to preview which orders would be cancelled; confirm=true to submit. Returns {cancelled, failed} on submit so you can see any per-order failures.",
    {
      accountNumber: z.string(),
      underlyingSymbol: z.string().optional(),
      confirm: z.boolean().default(skipConfirm),
    },
    async ({ accountNumber, underlyingSymbol, confirm }) =>
      wrap(async () => {
        const raw = await listOrders(http, accountNumber, {
          status: [...CANCELLABLE_STATUSES],
          ...(underlyingSymbol ? { underlyingSymbol } : {}),
        });
        const cancellable: ReadonlySet<string> = new Set(CANCELLABLE_STATUSES);
        const open = ((raw.items ?? []) as RawOpenOrder[]).filter(
          (o) => typeof o.status === "string" && cancellable.has(o.status),
        );

        if (open.length === 0) {
          return {
            submitted: false,
            wouldCancel: [],
            message: underlyingSymbol
              ? `No open orders for ${underlyingSymbol} on ${accountNumber}.`
              : `No open orders on ${accountNumber}.`,
          };
        }

        if (!confirm) {
          return {
            submitted: false,
            wouldCancel: open.map(slimOrder),
            message: `Re-call with confirm=true to cancel ${open.length} order(s).`,
          };
        }

        const results = await Promise.allSettled(
          open.map((o) => cancelOrder(http, accountNumber, o.id!)),
        );
        const cancelled: (number | string)[] = [];
        const failed: { orderId: number | string; error: string }[] = [];
        for (let i = 0; i < open.length; i++) {
          const r = results[i]!;
          const id = open[i]!.id!;
          if (r.status === "fulfilled") cancelled.push(id);
          else failed.push({ orderId: id, error: errorMessage(r.reason) });
        }
        return { submitted: true, cancelled, failed };
      }),
  );

  server.tool(
    "replace_order",
    skipConfirm
      ? "Replace an open order. TASTYTRADE_DANGEROUSLY_ALLOW_TRADING=1 is set — replaces by default. Pass confirm=false to force a dry-run preview instead."
      : "Replace an open order with a new one. confirm=true required.",
    {
      accountNumber: z.string(),
      orderId: z.union([z.string(), z.number()]),
      order: OrderRequestSchema,
      confirm: z.boolean().default(skipConfirm),
    },
    async ({ accountNumber, orderId, order, confirm }) =>
      wrap(async () => {
        if (!confirm) {
          const preview = await dryRunOrder(http, accountNumber, order as OrderRequest);
          return {
            replaced: false,
            message: "Dry-run preview only. Re-call with confirm=true to replace.",
            preview,
          };
        }
        const result = await replaceOrder(http, accountNumber, orderId, order as OrderRequest);
        return { replaced: true, result };
      }),
  );
};

// TastyTrade order statuses that are eligible for cancellation. Excludes terminal
// states (Filled, Cancelled, Rejected, Expired, Replaced) and in-flight cancels.
export const CANCELLABLE_STATUSES = ["Received", "Live", "Routed"] as const;

export type RawOpenOrder = {
  id?: number | string;
  status?: string;
  underlyingSymbol?: string;
  orderType?: string;
  timeInForce?: string;
  price?: number | string;
  priceEffect?: string;
  legs?: unknown[];
};

export const slimOrder = (o: RawOpenOrder): Record<string, unknown> => ({
  id: o.id ?? null,
  status: o.status ?? null,
  underlyingSymbol: o.underlyingSymbol ?? null,
  orderType: o.orderType ?? null,
  timeInForce: o.timeInForce ?? null,
  price: o.price ?? null,
  priceEffect: o.priceEffect ?? null,
  legCount: Array.isArray(o.legs) ? o.legs.length : 0,
});

const errorMessage = (reason: unknown): string => {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
};
