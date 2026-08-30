import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  getCryptocurrency,
  getEquity,
  getEquityOption,
  getFuture,
  getOptionChainNested,
} from "#/client/endpoints/instruments";
import {
  getDividendHistory,
  getEarningsHistory,
  getMarketMetrics,
} from "#/client/endpoints/market-metrics";
import { searchSymbols } from "#/client/endpoints/symbol-search";
import type { TastytradeHttpClient } from "#/client/http";
import { type EnrichedLeg, fetchEnrichedChain } from "#/lib/chain-greeks";
import { computeExpectedMove, pickAtmStrike, pickExpiration } from "#/lib/expected-move";
import { isFilterEmpty, type RawChainRoot, sliceChain, summarizeChain } from "#/lib/option-chain";
import { getMarketSnapshots } from "#/streaming/dxlink-snapshot";
import type { MarketDataProvider } from "#/streaming/market-data-provider";
import { wrap } from "#/tools/util";

export const registerInstrumentTools = (
  server: McpServer,
  http: TastytradeHttpClient,
  provider: MarketDataProvider,
): void => {
  server.registerTool(
    "tastytrade_search_symbols",
    {
      title: "TastyTrade: Search Symbols",
      description: "Search for tradable symbols by prefix.",
      inputSchema: { prefix: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async ({ prefix }) => wrap(() => searchSymbols(http, prefix)),
  );

  server.registerTool(
    "tastytrade_get_equity",
    {
      title: "TastyTrade: Get Equity",
      description: "Get instrument metadata for an equity symbol.",
      inputSchema: { symbol: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ symbol }) => wrap(() => getEquity(http, symbol)),
  );

  server.registerTool(
    "tastytrade_get_equity_option",
    {
      title: "TastyTrade: Get Equity Option",
      description: "Get instrument metadata for an OCC-formatted equity option symbol.",
      inputSchema: { symbol: z.string(), active: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ symbol, active }) =>
      wrap(() => getEquityOption(http, symbol, active === undefined ? undefined : { active })),
  );

  server.registerTool(
    "tastytrade_get_option_chain_summary",
    {
      title: "TastyTrade: Get Option Chain Summary",
      description:
        "Summarize all expirations for an underlying: one line per expiration with strike count and min/max strike. Tiny payload — use this first to pick an expiration, then call tastytrade_get_option_chain with a filter.",
      inputSchema: { underlyingSymbol: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ underlyingSymbol }) =>
      wrap(async () => {
        const raw = await getOptionChainNested(http, underlyingSymbol);
        const root = (raw.items?.[0] ?? raw) as RawChainRoot;
        return summarizeChain(root);
      }),
  );

  server.registerTool(
    "tastytrade_get_option_chain",
    {
      title: "TastyTrade: Get Option Chain",
      description:
        "Filtered option chain for an underlying. Returns a flat array of legs (one per call/put per strike) with both OCC and DXLink streamer symbols. If called without any filter, falls back to tastytrade_get_option_chain_summary's shape to avoid 200+ KB responses.",
      inputSchema: {
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
      annotations: { readOnlyHint: true },
    },
    async ({ underlyingSymbol, ...filter }) =>
      wrap(async () => {
        const raw = await getOptionChainNested(http, underlyingSymbol);
        const root = (raw.items?.[0] ?? raw) as RawChainRoot;
        if (isFilterEmpty(filter)) return summarizeChain(root);
        return sliceChain(root, filter);
      }),
  );

  server.registerTool(
    "tastytrade_get_expected_move",
    {
      title: "TastyTrade: Get Expected Move",
      description:
        "Compute the ATM straddle expected ±1σ move for an underlying at a given expiration. Returns underlying spot, ATM strike, call/put mids, the straddle price (≈ 1σ move in $), upper/lower bounds, and an IV-implied move for cross-check. Requires either `expirationDate` (exact YYYY-MM-DD) or `daysToExpiration` (nearest match). Issues two short-lived DXLink snapshots (spot, then ATM call+put).",
      inputSchema: {
        underlyingSymbol: z.string(),
        expirationDate: z.string().optional().describe("Exact YYYY-MM-DD"),
        daysToExpiration: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "If expirationDate is omitted, pick the expiration with DTE nearest this value",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ underlyingSymbol, expirationDate, daysToExpiration }) =>
      wrap(async () => {
        if (!expirationDate && daysToExpiration === undefined) {
          throw new Error("Provide either expirationDate or daysToExpiration");
        }
        if (provider.mode === "rest") {
          throw new Error(
            "tastytrade_get_expected_move requires DXLink streaming (Greeks/IV are not available via REST). Unset TASTYTRADE_DISABLE_DXLINK to use this tool.",
          );
        }
        const raw = await getOptionChainNested(http, underlyingSymbol);
        const root = (raw.items?.[0] ?? raw) as RawChainRoot;
        const expiration = pickExpiration(root, {
          ...(expirationDate ? { expirationDate } : {}),
          ...(daysToExpiration !== undefined ? { daysToExpiration } : {}),
        });

        const [underlyingSnap] = await getMarketSnapshots(provider, [underlyingSymbol], {
          types: ["Quote"],
        });
        const bid = underlyingSnap?.quote?.bidPrice ?? null;
        const ask = underlyingSnap?.quote?.askPrice ?? null;
        const spot = bid !== null && ask !== null ? (bid + ask) / 2 : null;
        if (spot === null) {
          throw new Error(`Could not get spot quote for ${underlyingSymbol}`);
        }

        const atmStrike = pickAtmStrike(expiration, spot);
        const optionSnaps = await getMarketSnapshots(
          provider,
          [atmStrike.callStreamerSymbol, atmStrike.putStreamerSymbol],
          { types: ["Quote", "Greeks"] },
        );
        const callSnap = optionSnaps.find((s) => s.dxlinkSymbol === atmStrike.callStreamerSymbol);
        const putSnap = optionSnaps.find((s) => s.dxlinkSymbol === atmStrike.putStreamerSymbol);

        return computeExpectedMove(
          underlyingSymbol,
          spot,
          expiration,
          atmStrike,
          callSnap,
          putSnap,
        );
      }),
  );

  server.registerTool(
    "tastytrade_get_chain_with_greeks",
    {
      title: "TastyTrade: Get Chain with Greeks",
      description:
        "Option chain slice enriched with quote (bid/ask/mid) and Greeks (delta/gamma/theta/vega/rho/IV) per leg. Bounded to a strike window around spot (default ATM±20 strikes) so the response stays compact. Use for spread / iron-condor design. Requires either expirationDate (exact YYYY-MM-DD) or daysToExpiration (nearest match).",
      inputSchema: {
        underlyingSymbol: z.string(),
        expirationDate: z.string().optional(),
        daysToExpiration: z.number().int().nonnegative().optional(),
        strikeWindow: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe("Number of strikes either side of spot (default 20)"),
        optionType: z.enum(["call", "put", "both"]).optional(),
        timeoutMs: z.number().int().positive().max(15000).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ underlyingSymbol, expirationDate, daysToExpiration, ...rest }) =>
      wrap(async () => {
        if (!expirationDate && daysToExpiration === undefined) {
          throw new Error("Provide either expirationDate or daysToExpiration");
        }
        return fetchEnrichedChain(http, provider, underlyingSymbol, {
          ...(expirationDate ? { expirationDate } : {}),
          ...(daysToExpiration !== undefined ? { daysToExpiration } : {}),
          ...rest,
        });
      }),
  );

  server.registerTool(
    "tastytrade_find_strikes_by_delta",
    {
      title: "TastyTrade: Find Strikes by Delta",
      description:
        "For each target delta, find the strike in the chain whose actual delta is closest. Useful for iron-condor / wing-selection workflows. Positive targets are matched against calls; negative targets against puts. Scans a strike window (default ATM±25) around spot.",
      inputSchema: {
        underlyingSymbol: z.string(),
        expirationDate: z.string().optional(),
        daysToExpiration: z.number().int().nonnegative().optional(),
        deltas: z.array(z.number().min(-1).max(1)).min(1).max(20),
        strikeWindow: z.number().int().positive().max(100).optional(),
        timeoutMs: z.number().int().positive().max(15000).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({
      underlyingSymbol,
      expirationDate,
      daysToExpiration,
      deltas,
      strikeWindow,
      timeoutMs,
    }) =>
      wrap(async () => {
        if (!expirationDate && daysToExpiration === undefined) {
          throw new Error("Provide either expirationDate or daysToExpiration");
        }
        const chain = await fetchEnrichedChain(http, provider, underlyingSymbol, {
          ...(expirationDate ? { expirationDate } : {}),
          ...(daysToExpiration !== undefined ? { daysToExpiration } : {}),
          strikeWindow: strikeWindow ?? 25,
          ...(timeoutMs ? { timeoutMs } : {}),
        });
        const matches = deltas.map((target) => pickStrikeByDelta(chain.legs, target));
        // In REST mode Greeks are null, so every match would have `leg: null` —
        // surface a clear reason rather than silently returning empties.
        const unavailableReason =
          provider.mode === "rest"
            ? "REST mode does not provide Greeks; unset TASTYTRADE_DISABLE_DXLINK for delta-based strike selection"
            : null;
        return {
          underlyingSymbol: chain.underlyingSymbol,
          expirationDate: chain.expirationDate,
          daysToExpiration: chain.daysToExpiration,
          underlyingPrice: chain.underlyingPrice,
          atmStrike: chain.atmStrike,
          matches,
          ...(unavailableReason ? { unavailableReason } : {}),
        };
      }),
  );

  server.registerTool(
    "tastytrade_get_earnings_calendar",
    {
      title: "TastyTrade: Get Earnings Calendar",
      description:
        "Bundled earnings dates for a batch of symbols. Wraps tastytrade_get_market_metrics and extracts {symbol, expectedReportDate, timeOfDay, estimatedEarnings} per name. Optional from/to (YYYY-MM-DD) filter on expectedReportDate; when neither is provided, all rows pass through (including those with no upcoming date).",
      inputSchema: {
        symbols: z.array(z.string()).min(1).max(100),
        from: z.string().optional().describe("YYYY-MM-DD inclusive lower bound"),
        to: z.string().optional().describe("YYYY-MM-DD inclusive upper bound"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ symbols, from, to }) =>
      wrap(async () => {
        const raw = await getMarketMetrics(http, symbols);
        const rows = ((raw.items ?? []) as Record<string, unknown>[]).map(extractEarnings);
        if (!from && !to) return rows;
        return rows.filter((r) => {
          if (!r.expectedReportDate) return false;
          if (from && r.expectedReportDate < from) return false;
          if (to && r.expectedReportDate > to) return false;
          return true;
        });
      }),
  );

  server.registerTool(
    "tastytrade_get_future",
    {
      title: "TastyTrade: Get Future",
      description: "Get instrument metadata for a futures symbol.",
      inputSchema: { symbol: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ symbol }) => wrap(() => getFuture(http, symbol)),
  );

  server.registerTool(
    "tastytrade_get_cryptocurrency",
    {
      title: "TastyTrade: Get Cryptocurrency",
      description: "Get instrument metadata for a crypto symbol (e.g. BTC/USD).",
      inputSchema: { symbol: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ symbol }) => wrap(() => getCryptocurrency(http, symbol)),
  );

  server.registerTool(
    "tastytrade_get_market_metrics",
    {
      title: "TastyTrade: Get Market Metrics",
      description:
        "Get IV rank/percentile, beta, liquidity, IV term structure, etc. for one or more symbols. Note: fields like dividendNextDate / earningsNextDate reflect the last known scheduled event and may be in the past if no upcoming event has been announced.",
      inputSchema: { symbols: z.array(z.string()).min(1).max(100) },
      annotations: { readOnlyHint: true },
    },
    async ({ symbols }) => wrap(() => getMarketMetrics(http, symbols)),
  );

  server.registerTool(
    "tastytrade_get_dividend_history",
    {
      title: "TastyTrade: Get Dividend History",
      description: "Historical dividends for a symbol.",
      inputSchema: { symbol: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ symbol }) => wrap(() => getDividendHistory(http, symbol)),
  );

  server.registerTool(
    "tastytrade_get_earnings_history",
    {
      title: "TastyTrade: Get Earnings History",
      description: "Historical earnings reports for a symbol.",
      inputSchema: { symbol: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ symbol }) => wrap(() => getEarningsHistory(http, symbol)),
  );
};

type StrikeMatch = {
  targetDelta: number;
  deltaDiff: number | null;
  leg: EnrichedLeg | null;
};

export const pickStrikeByDelta = (legs: EnrichedLeg[], target: number): StrikeMatch => {
  const wantType: "Call" | "Put" = target >= 0 ? "Call" : "Put";
  const candidates = legs.filter(
    (l): l is EnrichedLeg & { delta: number } => l.optionType === wantType && l.delta !== null,
  );
  if (candidates.length === 0) return { targetDelta: target, deltaDiff: null, leg: null };
  const best = candidates.toSorted(
    (a, b) => Math.abs(a.delta - target) - Math.abs(b.delta - target),
  )[0]!;
  return { targetDelta: target, deltaDiff: Math.abs(best.delta - target), leg: best };
};

type EarningsRow = {
  symbol: string;
  expectedReportDate: string | null;
  timeOfDay: string | null;
  estimatedEarnings: number | null;
};

const firstString = (...vals: unknown[]): string | null => {
  for (const v of vals) if (typeof v === "string" && v !== "") return v;
  return null;
};

const firstNumber = (...vals: unknown[]): number | null => {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
};

export const extractEarnings = (metric: Record<string, unknown>): EarningsRow => {
  const earnings = (metric.earnings ?? {}) as Record<string, unknown>;
  return {
    symbol: String(metric.symbol ?? ""),
    expectedReportDate: firstString(
      earnings.expectedReportDate,
      metric.earningsExpectedReportDate,
      metric.expectedReportDate,
    ),
    timeOfDay: firstString(
      earnings.timeOfDay,
      earnings.expectedTimeOfDay,
      metric.earningsTimeOfDay,
    ),
    estimatedEarnings: firstNumber(
      earnings.estimatedEarnings,
      earnings.consensusEstimate,
      metric.estimatedEarnings,
    ),
  };
};
