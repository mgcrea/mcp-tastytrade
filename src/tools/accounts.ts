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
  server.tool(
    "list_accounts",
    "List the customer's TastyTrade accounts (account numbers, nicknames, types).",
    {},
    async () => wrap(() => listAccounts(http)),
  );

  server.tool(
    "get_account",
    "Get details for a specific TastyTrade account.",
    { accountNumber: z.string().describe("Account number, e.g. 5WX12345") },
    async ({ accountNumber }) => wrap(() => getAccount(http, accountNumber)),
  );

  server.tool("get_customer", "Get the authenticated customer profile.", {}, async () =>
    wrap(() => getCustomer(http)),
  );

  server.tool(
    "get_balances",
    "Get current cash and margin balances for an account.",
    { accountNumber: z.string() },
    async ({ accountNumber }) => wrap(() => getBalances(http, accountNumber)),
  );

  server.tool(
    "get_positions",
    "List open (and optionally closed) positions for an account.",
    {
      accountNumber: z.string(),
      underlyingSymbol: z.array(z.string()).optional(),
      symbol: z.string().optional(),
      instrumentType: z.string().optional(),
      includeClosedPositions: z.boolean().optional(),
      netPositions: z.boolean().optional(),
      includeMarks: z.boolean().optional(),
    },
    async ({ accountNumber, ...query }) => wrap(() => getPositions(http, accountNumber, query)),
  );

  server.tool(
    "get_position_greeks",
    "Per-position greeks + per-underlying and portfolio-net totals for an account. Equity options use streamed Greeks via the long-lived DXLink session; equity positions contribute delta=1 per share. Contributions follow desk convention: signedQuantity × multiplier × per-contract greek. Returns missingMarks for any option leg whose quote/greeks couldn't be fetched.",
    {
      accountNumber: z.string(),
      includeClosedPositions: z.boolean().optional(),
      timeoutMs: z.number().int().positive().max(15000).optional(),
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
