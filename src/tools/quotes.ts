import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TastytradeHttpClient } from "../client/http.js";
import { getQuoteSnapshot } from "../streaming/dxlink-snapshot.js";
import { wrap } from "./util.js";

export const registerQuoteTools = (server: McpServer, http: TastytradeHttpClient): void => {
  server.tool(
    "get_quote",
    "Get a single real-time quote snapshot (bid/ask/sizes) for a symbol via DXLink. Disconnects after one event.",
    {
      symbol: z.string().describe("DXLink-format symbol, e.g. AAPL or .AAPL250620C200"),
      timeoutMs: z.number().int().positive().max(15000).optional(),
    },
    async ({ symbol, timeoutMs }) =>
      wrap(() => getQuoteSnapshot(http, symbol, timeoutMs === undefined ? {} : { timeoutMs })),
  );
};
