import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  cancelComplexOrder,
  type ComplexOrderRequest,
  dryRunComplexOrder,
  getComplexOrder,
  placeComplexOrder,
} from "#/client/endpoints/complex-orders";
import {
  cancelOrder,
  dryRunOrder,
  getOrder,
  listOrders,
  type OrderRequest,
  placeOrder,
  replaceOrder,
} from "#/client/endpoints/orders";
import type { TastytradeHttpClient } from "#/client/http";
import { wrap } from "#/tools/util";

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

export const ComplexOrderRequestSchema = z
  .object({
    type: z
      .enum(["OTOCO", "OCO", "OTO"])
      .describe(
        'OTOCO = entry triggers a linked profit-taker + stop-loss OCO pair. OCO = two orders ("brackets") attached to an existing position — fill or cancel of one cancels the other. OTO = entry triggers one or more follow-on orders without OCO linkage.',
      ),
    triggerOrder: OrderRequestSchema.optional().describe(
      "The entry order for OTOCO/OTO. Must be omitted for OCO.",
    ),
    orders: z
      .array(OrderRequestSchema)
      .min(1)
      .max(4)
      .describe(
        "Child orders. For OTOCO/OCO, must be exactly 2 (typically a take-profit Limit and a Stop/Stop Limit stop-loss).",
      ),
  })
  .superRefine((v, ctx) => {
    if ((v.type === "OTOCO" || v.type === "OTO") && !v.triggerOrder) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${v.type} requires triggerOrder`,
        path: ["triggerOrder"],
      });
    }
    if (v.type === "OCO" && v.triggerOrder) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "OCO must not include triggerOrder",
        path: ["triggerOrder"],
      });
    }
    if ((v.type === "OTOCO" || v.type === "OCO") && v.orders.length !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${v.type} requires exactly 2 child orders (e.g. take-profit + stop-loss)`,
        path: ["orders"],
      });
    }
  });

export const registerOrderReadTools = (server: McpServer, http: TastytradeHttpClient): void => {
  server.registerTool(
    "tastytrade_list_orders",
    {
      title: "TastyTrade: List Orders",
      description: "List orders for an account, optionally filtered by status / date range.",
      inputSchema: {
        accountNumber: z.string(),
        perPage: z.number().int().positive().max(2000).optional(),
        pageOffset: z.number().int().nonnegative().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        status: z.array(z.string()).optional(),
        underlyingSymbol: z.string().optional(),
        sort: z.enum(["Desc", "Asc"]).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ accountNumber, ...query }) => wrap(() => listOrders(http, accountNumber, query)),
  );

  server.registerTool(
    "tastytrade_get_order",
    {
      title: "TastyTrade: Get Order",
      description: "Get a single order by id.",
      inputSchema: { accountNumber: z.string(), orderId: z.union([z.string(), z.number()]) },
      annotations: { readOnlyHint: true },
    },
    async ({ accountNumber, orderId }) => wrap(() => getOrder(http, accountNumber, orderId)),
  );

  server.registerTool(
    "tastytrade_get_complex_order",
    {
      title: "TastyTrade: Get Complex Order",
      description:
        "Get a single complex order (OTOCO/OCO/OTO bracket) by id, including all linked child orders.",
      inputSchema: { accountNumber: z.string(), orderId: z.union([z.string(), z.number()]) },
      annotations: { readOnlyHint: true },
    },
    async ({ accountNumber, orderId }) => wrap(() => getComplexOrder(http, accountNumber, orderId)),
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

  server.registerTool(
    "tastytrade_place_order",
    {
      title: "TastyTrade: Place Order",
      description: placeDescription,
      inputSchema: {
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
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
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

  server.registerTool(
    "tastytrade_cancel_order",
    {
      title: "TastyTrade: Cancel Order",
      description: skipConfirm
        ? "Cancel an open order. TASTYTRADE_DANGEROUSLY_ALLOW_TRADING=1 is set — cancels immediately by default."
        : "Cancel an open order.",
      inputSchema: {
        accountNumber: z.string(),
        orderId: z.union([z.string(), z.number()]),
        confirm: z.boolean().default(skipConfirm),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
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

  server.registerTool(
    "tastytrade_cancel_all_orders",
    {
      title: "TastyTrade: Cancel All Orders",
      description: skipConfirm
        ? "Cancel every open order on an account (optionally filtered by underlyingSymbol). TASTYTRADE_DANGEROUSLY_ALLOW_TRADING=1 is set — cancels immediately by default. Pass confirm=false to force a dry-run preview. Returns {cancelled, failed} on submit; partial failures are reported per order."
        : "Cancel every open order on an account (optionally filtered by underlyingSymbol). Call with confirm=false (default) to preview which orders would be cancelled; confirm=true to submit. Returns {cancelled, failed} on submit so you can see any per-order failures.",
      inputSchema: {
        accountNumber: z.string(),
        underlyingSymbol: z.string().optional(),
        confirm: z.boolean().default(skipConfirm),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
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

  server.registerTool(
    "tastytrade_replace_order",
    {
      title: "TastyTrade: Replace Order",
      description: skipConfirm
        ? "Replace an open order. TASTYTRADE_DANGEROUSLY_ALLOW_TRADING=1 is set — replaces by default. Pass confirm=false to force a dry-run preview instead."
        : "Replace an open order with a new one. confirm=true required.",
      inputSchema: {
        accountNumber: z.string(),
        orderId: z.union([z.string(), z.number()]),
        order: OrderRequestSchema,
        confirm: z.boolean().default(skipConfirm),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
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

  const placeComplexDescription = skipConfirm
    ? "Submit a complex order (OTOCO bracket / OCO pair / OTO chain) so an entry and its stop-loss + take-profit are linked atomically. TASTYTRADE_DANGEROUSLY_ALLOW_TRADING=1 is set — submits by default. Pass confirm=false to force a dry-run preview instead."
    : "Submit a complex order (OTOCO bracket / OCO pair / OTO chain) so an entry and its stop-loss + take-profit are linked atomically. Call with confirm=false (default) for a dry-run preview; confirm=true to submit. For OTOCO: triggerOrder is the entry, orders=[take-profit Limit, stop-loss Stop/Stop Limit]. Filling/cancelling one child cancels the other so the stop can't be orphaned.";

  server.registerTool(
    "tastytrade_place_complex_order",
    {
      title: "TastyTrade: Place Complex Order",
      description: placeComplexDescription,
      inputSchema: {
        accountNumber: z.string(),
        order: ComplexOrderRequestSchema,
        confirm: z
          .boolean()
          .default(skipConfirm)
          .describe(
            skipConfirm
              ? "true (default with DANGEROUSLY flag) submits; false forces a dry-run preview."
              : "false (default) returns a dry-run preview; true submits the order.",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ accountNumber, order, confirm }) =>
      wrap(async () => {
        if (!confirm) {
          const preview = await dryRunComplexOrder(
            http,
            accountNumber,
            order as ComplexOrderRequest,
          );
          return {
            submitted: false,
            message: "Dry-run preview only. Re-call with confirm=true to submit this bracket.",
            preview,
          };
        }
        const submitted = await placeComplexOrder(
          http,
          accountNumber,
          order as ComplexOrderRequest,
        );
        return { submitted: true, result: submitted };
      }),
  );

  server.registerTool(
    "tastytrade_cancel_complex_order",
    {
      title: "TastyTrade: Cancel Complex Order",
      description: skipConfirm
        ? "Cancel a complex order (OTOCO/OCO/OTO) and all of its linked child orders. TASTYTRADE_DANGEROUSLY_ALLOW_TRADING=1 is set — cancels immediately by default."
        : "Cancel a complex order (OTOCO/OCO/OTO) and all of its linked child orders.",
      inputSchema: {
        accountNumber: z.string(),
        orderId: z.union([z.string(), z.number()]),
        confirm: z.boolean().default(skipConfirm),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ accountNumber, orderId, confirm }) =>
      wrap(async () => {
        if (!confirm) {
          return {
            cancelled: false,
            message: `Re-call with confirm=true to cancel complex order ${String(orderId)}.`,
          };
        }
        const result = await cancelComplexOrder(http, accountNumber, orderId);
        return { cancelled: true, result };
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
