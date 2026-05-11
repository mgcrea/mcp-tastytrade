import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { DxlinkSession } from "../streaming/dxlink-session.js";
import { getMarketSnapshot, getMarketSnapshots } from "../streaming/dxlink-snapshot.js";
import { wrap } from "./util.js";

const EventType = z.enum(["Quote", "Greeks"]);

export const registerQuoteTools = (server: McpServer, session: DxlinkSession): void => {
  server.tool(
    "get_quote",
    "Snapshot of a single symbol via DXLink. Accepts either OCC (e.g. 'IWM   260529C00300000') or DXLink (e.g. '.IWM260529C300') option formats. Returns Quote (bid/ask/sizes); for option symbols also returns Greeks (delta/gamma/theta/vega/rho/IV) by default. Reuses a long-lived DXLink connection; repeat queries for already-subscribed symbols return cached values immediately.",
    {
      symbol: z.string().describe("OCC or DXLink symbol, or an equity ticker like 'AAPL'"),
      types: z
        .array(EventType)
        .optional()
        .describe(
          "Event types to wait for. Defaults: ['Quote'] for equities, ['Quote','Greeks'] for options.",
        ),
      timeoutMs: z.number().int().positive().max(15000).optional(),
    },
    async ({ symbol, types, timeoutMs }) =>
      wrap(() =>
        getMarketSnapshot(session, symbol, {
          ...(types ? { types } : {}),
          ...(timeoutMs ? { timeoutMs } : {}),
        }),
      ),
  );

  server.tool(
    "get_quotes",
    "Batch snapshot for multiple symbols sharing the long-lived DXLink connection. Accepts a mix of equity tickers, OCC options, and DXLink options. Returns an array preserving input order; option symbols include Greeks by default.",
    {
      symbols: z.array(z.string()).min(1).max(50),
      types: z.array(EventType).optional(),
      timeoutMs: z.number().int().positive().max(15000).optional(),
    },
    async ({ symbols, types, timeoutMs }) =>
      wrap(() =>
        getMarketSnapshots(session, symbols, {
          ...(types ? { types } : {}),
          ...(timeoutMs ? { timeoutMs } : {}),
        }),
      ),
  );
};
