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

  server.tool(
    "dry_run_order",
    "Validate an order against TastyTrade's risk and margin checks without submitting it. Always available.",
    { accountNumber: z.string(), order: OrderRequestSchema },
    async ({ accountNumber, order }) =>
      wrap(() => dryRunOrder(http, accountNumber, order as OrderRequest)),
  );
};

export const registerOrderWriteTools = (server: McpServer, http: TastytradeHttpClient): void => {
  server.tool(
    "place_order",
    "Submit an order to the market. Without confirm=true, returns a dry-run preview instead of submitting.",
    {
      accountNumber: z.string(),
      order: OrderRequestSchema,
      confirm: z
        .boolean()
        .default(false)
        .describe("Must be true to actually submit; otherwise returns a dry-run preview."),
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
    "Cancel an open order.",
    {
      accountNumber: z.string(),
      orderId: z.union([z.string(), z.number()]),
      confirm: z.boolean().default(false),
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
    "replace_order",
    "Replace an open order with a new one. confirm=true required.",
    {
      accountNumber: z.string(),
      orderId: z.union([z.string(), z.number()]),
      order: OrderRequestSchema,
      confirm: z.boolean().default(false),
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
