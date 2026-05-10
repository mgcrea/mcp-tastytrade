import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  getCryptocurrency,
  getEquity,
  getEquityOption,
  getFuture,
  getOptionChainCompact,
  getOptionChainNested,
} from "../client/endpoints/instruments.js";
import {
  getDividendHistory,
  getEarningsHistory,
  getMarketMetrics,
} from "../client/endpoints/market-metrics.js";
import { searchSymbols } from "../client/endpoints/symbol-search.js";
import type { TastytradeHttpClient } from "../client/http.js";
import { wrap } from "./util.js";

export const registerInstrumentTools = (server: McpServer, http: TastytradeHttpClient): void => {
  server.tool(
    "search_symbols",
    "Search for tradable symbols by prefix.",
    { prefix: z.string().min(1) },
    async ({ prefix }) => wrap(() => searchSymbols(http, prefix)),
  );

  server.tool(
    "get_equity",
    "Get instrument metadata for an equity symbol.",
    { symbol: z.string() },
    async ({ symbol }) => wrap(() => getEquity(http, symbol)),
  );

  server.tool(
    "get_equity_option",
    "Get instrument metadata for an OCC-formatted equity option symbol.",
    { symbol: z.string(), active: z.boolean().optional() },
    async ({ symbol, active }) =>
      wrap(() => getEquityOption(http, symbol, active === undefined ? undefined : { active })),
  );

  server.tool(
    "get_option_chain",
    "Get the option chain for an underlying symbol (nested by default; pass format=compact for the flat layout).",
    { underlyingSymbol: z.string(), format: z.enum(["nested", "compact"]).default("nested") },
    async ({ underlyingSymbol, format }) =>
      wrap(() =>
        format === "compact"
          ? getOptionChainCompact(http, underlyingSymbol)
          : getOptionChainNested(http, underlyingSymbol),
      ),
  );

  server.tool(
    "get_future",
    "Get instrument metadata for a futures symbol.",
    { symbol: z.string() },
    async ({ symbol }) => wrap(() => getFuture(http, symbol)),
  );

  server.tool(
    "get_cryptocurrency",
    "Get instrument metadata for a crypto symbol (e.g. BTC/USD).",
    { symbol: z.string() },
    async ({ symbol }) => wrap(() => getCryptocurrency(http, symbol)),
  );

  server.tool(
    "get_market_metrics",
    "Get IV rank/percentile, beta, liquidity, etc. for one or more symbols.",
    { symbols: z.array(z.string()).min(1).max(100) },
    async ({ symbols }) => wrap(() => getMarketMetrics(http, symbols)),
  );

  server.tool(
    "get_dividend_history",
    "Historical dividends for a symbol.",
    { symbol: z.string() },
    async ({ symbol }) => wrap(() => getDividendHistory(http, symbol)),
  );

  server.tool(
    "get_earnings_history",
    "Historical earnings reports for a symbol.",
    { symbol: z.string() },
    async ({ symbol }) => wrap(() => getEarningsHistory(http, symbol)),
  );
};
