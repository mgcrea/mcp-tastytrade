// Shared helper: fetch a chain slice and enrich each leg with quote + greeks
// in a single batched DXLink call. Used by get_chain_with_greeks and find_strikes_by_delta.

import { getOptionChainNested } from "../client/endpoints/instruments.js";
import type { TastytradeHttpClient } from "../client/http.js";
import type { DxlinkSession } from "../streaming/dxlink-session.js";
import type { MarketSnapshot } from "../streaming/dxlink-snapshot.js";

import { pickAtmStrike, pickExpiration } from "./expected-move.js";
import {
  type ChainLeg,
  type RawChainExpiration,
  type RawChainRoot,
  type RawChainStrike,
  sliceChain,
} from "./option-chain.js";

export type EnrichedLeg = ChainLeg & {
  bid: number | null;
  ask: number | null;
  mid: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  iv: number | null;
};

export type EnrichedChain = {
  underlyingSymbol: string;
  underlyingPrice: number | null;
  expirationDate: string;
  daysToExpiration: number;
  atmStrike: number | null;
  legs: EnrichedLeg[];
};

export type ChainGreeksOptions = {
  expirationDate?: string;
  daysToExpiration?: number;
  // ATM window selection — default is centered on snapshot spot if available.
  strikeWindow?: number; // count of strikes either side of center; default 20
  optionType?: "call" | "put" | "both";
  timeoutMs?: number;
};

const midPrice = (b: number | null, a: number | null): number | null =>
  b !== null && a !== null ? (b + a) / 2 : null;

export const enrichLeg = (leg: ChainLeg, snap: MarketSnapshot | undefined): EnrichedLeg => {
  const bid = snap?.quote?.bidPrice ?? null;
  const ask = snap?.quote?.askPrice ?? null;
  return {
    ...leg,
    bid,
    ask,
    mid: midPrice(bid, ask),
    delta: snap?.greeks?.delta ?? null,
    gamma: snap?.greeks?.gamma ?? null,
    theta: snap?.greeks?.theta ?? null,
    vega: snap?.greeks?.vega ?? null,
    rho: snap?.greeks?.rho ?? null,
    iv: snap?.greeks?.volatility ?? null,
  };
};

const strikesAroundSpot = (
  expiration: RawChainExpiration,
  spot: number | null,
  count: number,
): RawChainStrike[] => {
  const all = (expiration.strikes ?? []).filter((s) => Number.isFinite(Number(s.strikePrice)));
  if (spot === null) {
    // No spot reference — keep the middle slice of the chain
    if (all.length <= count * 2) return all;
    const mid = Math.floor(all.length / 2);
    return all.slice(Math.max(0, mid - count), Math.min(all.length, mid + count));
  }
  return all
    .toSorted((a, b) => Math.abs(Number(a.strikePrice) - spot) - Math.abs(Number(b.strikePrice) - spot))
    .slice(0, count * 2)
    .toSorted((a, b) => Number(a.strikePrice) - Number(b.strikePrice));
};

export const fetchEnrichedChain = async (
  http: TastytradeHttpClient,
  session: DxlinkSession,
  underlyingSymbol: string,
  opts: ChainGreeksOptions,
): Promise<EnrichedChain> => {
  const raw = await getOptionChainNested(http, underlyingSymbol);
  const root = (raw.items?.[0] ?? raw) as RawChainRoot;

  const expiration = pickExpiration(root, {
    ...(opts.expirationDate ? { expirationDate: opts.expirationDate } : {}),
    ...(opts.daysToExpiration !== undefined ? { daysToExpiration: opts.daysToExpiration } : {}),
  });

  // Spot quote for ATM centering
  let spot: number | null = null;
  try {
    const [u] = await session.snapshot([underlyingSymbol], ["Quote"], opts.timeoutMs);
    const bid = u?.quote?.bidPrice ?? null;
    const ask = u?.quote?.askPrice ?? null;
    spot = bid !== null && ask !== null ? (bid + ask) / 2 : null;
  } catch {
    // Spot is best-effort; fall back to chain midpoint
  }

  const window = opts.strikeWindow ?? 20;
  const windowStrikes = strikesAroundSpot(expiration, spot, window);
  const atmStrike =
    spot !== null && expiration.strikes && expiration.strikes.length > 0
      ? Number(pickAtmStrike(expiration, spot).strikePrice)
      : null;

  // Build a slim slice from just the windowed strikes
  const slimExpiration: RawChainExpiration = { ...expiration, strikes: windowStrikes };
  const slimRoot: RawChainRoot = { ...root, expirations: [slimExpiration] };
  const slice = sliceChain(slimRoot, opts.optionType ? { optionType: opts.optionType } : {});

  if (slice.legs.length === 0) {
    return {
      underlyingSymbol,
      underlyingPrice: spot,
      expirationDate: expiration.expirationDate,
      daysToExpiration: expiration.daysToExpiration,
      atmStrike,
      legs: [],
    };
  }

  const streamerSymbols = slice.legs.map((l) => l.streamerSymbol);
  const snaps = await session.snapshot(streamerSymbols, ["Quote", "Greeks"], opts.timeoutMs);
  const snapMap = new Map(snaps.map((s) => [s.dxlinkSymbol, s] as const));

  return {
    underlyingSymbol,
    underlyingPrice: spot,
    expirationDate: expiration.expirationDate,
    daysToExpiration: expiration.daysToExpiration,
    atmStrike,
    legs: slice.legs.map((leg) => enrichLeg(leg, snapMap.get(leg.streamerSymbol))),
  };
};
