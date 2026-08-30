import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getTransaction, listTransactions } from "#/client/endpoints/transactions";
import type { TastytradeHttpClient } from "#/client/http";
import { wrap } from "#/tools/util";

export const registerTransactionTools = (server: McpServer, http: TastytradeHttpClient): void => {
  server.registerTool(
    "tastytrade_list_transactions",
    {
      description: "List transactions for an account, with optional date range and filters.",
      inputSchema: {
        accountNumber: z.string(),
        perPage: z.number().int().positive().max(2000).optional(),
        pageOffset: z.number().int().nonnegative().optional(),
        sort: z.enum(["Desc", "Asc"]).optional(),
        startDate: z.string().optional().describe("YYYY-MM-DD"),
        endDate: z.string().optional().describe("YYYY-MM-DD"),
        type: z.string().optional(),
        symbol: z.string().optional(),
        underlyingSymbol: z.string().optional(),
        instrumentType: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ accountNumber, ...query }) => wrap(() => listTransactions(http, accountNumber, query)),
  );

  server.registerTool(
    "tastytrade_get_transaction",
    {
      description: "Get a single transaction by id.",
      inputSchema: { accountNumber: z.string(), id: z.union([z.string(), z.number()]) },
      annotations: { readOnlyHint: true },
    },
    async ({ accountNumber, id }) => wrap(() => getTransaction(http, accountNumber, id)),
  );
};
