import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getTransaction, listTransactions } from "../client/endpoints/transactions.js";
import type { TastytradeHttpClient } from "../client/http.js";
import { wrap } from "./util.js";

export const registerTransactionTools = (server: McpServer, http: TastytradeHttpClient): void => {
  server.tool(
    "list_transactions",
    "List transactions for an account, with optional date range and filters.",
    {
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
    async ({ accountNumber, ...query }) => wrap(() => listTransactions(http, accountNumber, query)),
  );

  server.tool(
    "get_transaction",
    "Get a single transaction by id.",
    { accountNumber: z.string(), id: z.union([z.string(), z.number()]) },
    async ({ accountNumber, id }) => wrap(() => getTransaction(http, accountNumber, id)),
  );
};
