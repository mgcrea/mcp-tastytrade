import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAccount, getCustomer, listAccounts } from "../client/endpoints/accounts.js";
import { getBalances } from "../client/endpoints/balances.js";
import { getPositions } from "../client/endpoints/positions.js";
import type { TastytradeHttpClient } from "../client/http.js";
import { wrap } from "./util.js";

export const registerAccountTools = (server: McpServer, http: TastytradeHttpClient): void => {
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
};
