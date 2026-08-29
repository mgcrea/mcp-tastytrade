import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getAccount, getCustomer, listAccounts } from "../client/endpoints/accounts.js";
import { getBalances } from "../client/endpoints/balances.js";
import { getPositions } from "../client/endpoints/positions.js";
import type { TastytradeHttpClient } from "../client/http.js";
import {
  enrichPositions,
  isActivePosition,
  isOptionPosition,
  type RawPosition,
} from "../lib/position-greeks.js";
import type { MarketDataProvider } from "../streaming/market-data-provider.js";
import { wrap } from "./util.js";

export const registerAccountTools = (
  server: McpServer,
  http: TastytradeHttpClient,
  provider: MarketDataProvider,
): void => {
  server.registerTool(
    "tastytrade_list_accounts",
    {
      description: "List the customer's TastyTrade accounts (account numbers, nicknames, types).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => wrap(() => listAccounts(http)),
  );

  server.registerTool(
    "tastytrade_get_account",
    {
      description: "Get details for a specific TastyTrade account.",
      inputSchema: { accountNumber: z.string().describe("Account number, e.g. 5WX12345") },
      annotations: { readOnlyHint: true },
    },
    async ({ accountNumber }) => wrap(() => getAccount(http, accountNumber)),
  );

  server.registerTool(
    "tastytrade_get_customer",
    {
      description: "Get the authenticated customer profile.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => wrap(() => getCustomer(http)),
  );

  server.registerTool(
    "tastytrade_get_balances",
    {
      description: "Get current cash and margin balances for an account.",
      inputSchema: { accountNumber: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ accountNumber }) => wrap(() => getBalances(http, accountNumber)),
  );

  server.registerTool(
    "tastytrade_get_positions",
    {
      description: "List open (and optionally closed) positions for an account.",
      inputSchema: {
        accountNumber: z.string(),
        underlyingSymbol: z.array(z.string()).optional(),
        symbol: z.string().optional(),
        instrumentType: z.string().optional(),
        includeClosedPositions: z.boolean().optional(),
        netPositions: z.boolean().optional(),
        includeMarks: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ accountNumber, ...query }) => wrap(() => getPositions(http, accountNumber, query)),
  );

  server.registerTool(
    "tastytrade_get_position_greeks",
    {
      description:
        "Per-position greeks + per-underlying and portfolio-net totals for an account. Equity options use streamed Greeks via the long-lived DXLink session; equity positions contribute delta=1 per share. Contributions follow desk convention: signedQuantity × multiplier × per-contract greek. Returns missingMarks for any option leg whose quote/greeks couldn't be fetched.",
      inputSchema: {
        accountNumber: z.string(),
        includeClosedPositions: z.boolean().optional(),
        timeoutMs: z.number().int().positive().max(15000).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ accountNumber, includeClosedPositions, timeoutMs }) =>
      wrap(async () => {
        const raw = await getPositions(
          http,
          accountNumber,
          includeClosedPositions !== undefined ? { includeClosedPositions } : {},
        );
        const positions = ((raw.items ?? []) as RawPosition[]).filter(isActivePosition);
        const optionSymbols = positions.filter(isOptionPosition).map((p) => p.symbol);
        const snaps =
          optionSymbols.length > 0
            ? await provider.snapshot(optionSymbols, ["Quote", "Greeks"], timeoutMs)
            : [];
        return enrichPositions(positions, snaps, accountNumber);
      }),
  );
};
