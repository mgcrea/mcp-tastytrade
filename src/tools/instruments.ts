import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  getCryptocurrency,
  getEquity,
  getEquityOption,
  getFuture,
  getOptionChainNested,
} from "../client/endpoints/instruments.js";
import {
  getDividendHistory,
  getEarningsHistory,
  getMarketMetrics,
} from "../client/endpoints/market-metrics.js";
import { searchSymbols } from "../client/endpoints/symbol-search.js";
import type { TastytradeHttpClient } from "../client/http.js";
import {
  isFilterEmpty,
  type RawChainRoot,
  sliceChain,
  summarizeChain,
} from "../lib/option-chain.js";
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
    "get_option_chain_summary",
    "Summarize all expirations for an underlying: one line per expiration with strike count and min/max strike. Tiny payload — use this first to pick an expiration, then call get_option_chain with a filter.",
    { underlyingSymbol: z.string() },
    async ({ underlyingSymbol }) =>
      wrap(async () => {
        const raw = await getOptionChainNested(http, underlyingSymbol);
        const root = (raw.items?.[0] ?? raw) as RawChainRoot;
        return summarizeChain(root);
      }),
  );

  server.tool(
    "get_option_chain",
    "Filtered option chain for an underlying. Returns a flat array of legs (one per call/put per strike) with both OCC and DXLink streamer symbols. If called without any filter, falls back to get_option_chain_summary's shape to avoid 200+ KB responses.",
    {
      underlyingSymbol: z.string(),
      expirationDate: z.string().optional().describe("Exact YYYY-MM-DD"),
      daysToExpirationMin: z.number().int().nonnegative().optional(),
      daysToExpirationMax: z.number().int().positive().optional(),
      strikeMin: z.number().positive().optional(),
      strikeMax: z.number().positive().optional(),
      strikeAround: z
        .object({ center: z.number().positive(), count: z.number().int().positive().max(200) })
        .optional()
        .describe("Pick the N strikes nearest `center`."),
      optionType: z.enum(["call", "put", "both"]).optional(),
    },
    async ({ underlyingSymbol, ...filter }) =>
      wrap(async () => {
        const raw = await getOptionChainNested(http, underlyingSymbol);
        const root = (raw.items?.[0] ?? raw) as RawChainRoot;
        if (isFilterEmpty(filter)) return summarizeChain(root);
        return sliceChain(root, filter);
      }),
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
    "Get IV rank/percentile, beta, liquidity, IV term structure, etc. for one or more symbols. Note: fields like dividendNextDate / earningsNextDate reflect the last known scheduled event and may be in the past if no upcoming event has been announced.",
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
