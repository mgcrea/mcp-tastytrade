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
import { type EnrichedLeg, fetchEnrichedChain } from "../lib/chain-greeks.js";
import { computeExpectedMove, pickAtmStrike, pickExpiration } from "../lib/expected-move.js";
import {
  isFilterEmpty,
  type RawChainRoot,
  sliceChain,
  summarizeChain,
} from "../lib/option-chain.js";
import type { DxlinkSession } from "../streaming/dxlink-session.js";
import { getMarketSnapshots } from "../streaming/dxlink-snapshot.js";
import { wrap } from "./util.js";

export const registerInstrumentTools = (
  server: McpServer,
  http: TastytradeHttpClient,
  session: DxlinkSession,
): void => {
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
    "get_expected_move",
    "Compute the ATM straddle expected ±1σ move for an underlying at a given expiration. Returns underlying spot, ATM strike, call/put mids, the straddle price (≈ 1σ move in $), upper/lower bounds, and an IV-implied move for cross-check. Requires either `expirationDate` (exact YYYY-MM-DD) or `daysToExpiration` (nearest match). Issues two short-lived DXLink snapshots (spot, then ATM call+put).",
    {
      underlyingSymbol: z.string(),
      expirationDate: z.string().optional().describe("Exact YYYY-MM-DD"),
      daysToExpiration: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("If expirationDate is omitted, pick the expiration with DTE nearest this value"),
    },
    async ({ underlyingSymbol, expirationDate, daysToExpiration }) =>
      wrap(async () => {
        if (!expirationDate && daysToExpiration === undefined) {
          throw new Error("Provide either expirationDate or daysToExpiration");
        }
        const raw = await getOptionChainNested(http, underlyingSymbol);
        const root = (raw.items?.[0] ?? raw) as RawChainRoot;
        const expiration = pickExpiration(root, {
          ...(expirationDate ? { expirationDate } : {}),
          ...(daysToExpiration !== undefined ? { daysToExpiration } : {}),
        });

        const [underlyingSnap] = await getMarketSnapshots(session, [underlyingSymbol], {
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
          session,
          [atmStrike.callStreamerSymbol, atmStrike.putStreamerSymbol],
          { types: ["Quote", "Greeks"] },
        );
        const callSnap = optionSnaps.find(
          (s) => s.dxlinkSymbol === atmStrike.callStreamerSymbol,
        );
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

  server.tool(
    "get_chain_with_greeks",
    "Option chain slice enriched with quote (bid/ask/mid) and Greeks (delta/gamma/theta/vega/rho/IV) per leg. Bounded to a strike window around spot (default ATM±20 strikes) so the response stays compact. Use for spread / iron-condor design. Requires either expirationDate (exact YYYY-MM-DD) or daysToExpiration (nearest match).",
    {
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
    async ({ underlyingSymbol, expirationDate, daysToExpiration, ...rest }) =>
      wrap(async () => {
        if (!expirationDate && daysToExpiration === undefined) {
          throw new Error("Provide either expirationDate or daysToExpiration");
        }
        return fetchEnrichedChain(http, session, underlyingSymbol, {
          ...(expirationDate ? { expirationDate } : {}),
          ...(daysToExpiration !== undefined ? { daysToExpiration } : {}),
          ...rest,
        });
      }),
  );

  server.tool(
    "find_strikes_by_delta",
    "For each target delta, find the strike in the chain whose actual delta is closest. Useful for iron-condor / wing-selection workflows. Positive targets are matched against calls; negative targets against puts. Scans a strike window (default ATM±25) around spot.",
    {
      underlyingSymbol: z.string(),
      expirationDate: z.string().optional(),
      daysToExpiration: z.number().int().nonnegative().optional(),
      deltas: z.array(z.number().min(-1).max(1)).min(1).max(20),
      strikeWindow: z.number().int().positive().max(100).optional(),
      timeoutMs: z.number().int().positive().max(15000).optional(),
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
        const chain = await fetchEnrichedChain(http, session, underlyingSymbol, {
          ...(expirationDate ? { expirationDate } : {}),
          ...(daysToExpiration !== undefined ? { daysToExpiration } : {}),
          strikeWindow: strikeWindow ?? 25,
          ...(timeoutMs ? { timeoutMs } : {}),
        });
        const matches = deltas.map((target) => pickStrikeByDelta(chain.legs, target));
        return {
          underlyingSymbol: chain.underlyingSymbol,
          expirationDate: chain.expirationDate,
          daysToExpiration: chain.daysToExpiration,
          underlyingPrice: chain.underlyingPrice,
          atmStrike: chain.atmStrike,
          matches,
        };
      }),
  );

  server.tool(
    "get_earnings_calendar",
    "Bundled earnings dates for a batch of symbols. Wraps get_market_metrics and extracts {symbol, expectedReportDate, timeOfDay, estimatedEarnings} per name. Optional from/to (YYYY-MM-DD) filter on expectedReportDate; when neither is provided, all rows pass through (including those with no upcoming date).",
    {
      symbols: z.array(z.string()).min(1).max(100),
      from: z.string().optional().describe("YYYY-MM-DD inclusive lower bound"),
      to: z.string().optional().describe("YYYY-MM-DD inclusive upper bound"),
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

type StrikeMatch = {
  targetDelta: number;
  deltaDiff: number | null;
  leg: EnrichedLeg | null;
};

export const pickStrikeByDelta = (legs: EnrichedLeg[], target: number): StrikeMatch => {
  const wantType: "Call" | "Put" = target >= 0 ? "Call" : "Put";
  const candidates = legs.filter(
    (l): l is EnrichedLeg & { delta: number } =>
      l.optionType === wantType && l.delta !== null,
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
