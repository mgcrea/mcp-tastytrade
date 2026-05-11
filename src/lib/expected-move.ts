// Expected-move helper: ATM straddle price ≈ the 1σ expected move for the underlying
// at a given expiration. We also compute an IV-implied move (underlying * IV * √(DTE/365))
// for comparison — the two should be in the same ballpark for liquid names.

import type { MarketSnapshot } from "../streaming/dxlink-snapshot.js";

import type { RawChainExpiration, RawChainRoot, RawChainStrike } from "./option-chain.js";

export type LegQuote = {
  occ: string;
  streamerSymbol: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  delta: number | null;
  iv: number | null;
};

export type ExpectedMove = {
  underlyingSymbol: string;
  underlyingPrice: number;
  expirationDate: string;
  daysToExpiration: number;
  atmStrike: number;
  atmCall: LegQuote;
  atmPut: LegQuote;
  straddleMid: number | null;
  expectedMovePercent: number | null;
  upperBound: number | null;
  lowerBound: number | null;
  ivImpliedMove: number | null;
  impliedVolatility: number | null;
};

const num = (s: string): number => Number(s);

export const pickExpiration = (
  root: RawChainRoot,
  by: { expirationDate?: string; daysToExpiration?: number },
): RawChainExpiration => {
  const exps = root.expirations ?? [];
  if (exps.length === 0) throw new Error("No expirations available for this underlying");
  if (by.expirationDate) {
    const found = exps.find((e) => e.expirationDate === by.expirationDate);
    if (!found) {
      const available = exps.map((e) => e.expirationDate).join(", ");
      throw new Error(`No expiration ${by.expirationDate}. Available: ${available}`);
    }
    return found;
  }
  if (by.daysToExpiration !== undefined) {
    const target = by.daysToExpiration;
    const sorted = exps.toSorted(
      (a, b) => Math.abs(a.daysToExpiration - target) - Math.abs(b.daysToExpiration - target),
    );
    return sorted[0]!;
  }
  throw new Error("Need expirationDate or daysToExpiration to pick an expiration");
};

export const pickAtmStrike = (expiration: RawChainExpiration, spot: number): RawChainStrike => {
  const strikes = (expiration.strikes ?? []).filter((s) => Number.isFinite(num(s.strikePrice)));
  if (strikes.length === 0) throw new Error("No strikes in selected expiration");
  const sorted = strikes.toSorted(
    (a, b) => Math.abs(num(a.strikePrice) - spot) - Math.abs(num(b.strikePrice) - spot),
  );
  return sorted[0]!;
};

const midPrice = (b: number | null, a: number | null): number | null =>
  b !== null && a !== null ? (b + a) / 2 : null;

export const buildLegQuote = (
  occ: string,
  streamerSymbol: string,
  snapshot: MarketSnapshot | undefined,
): LegQuote => {
  const bid = snapshot?.quote?.bidPrice ?? null;
  const ask = snapshot?.quote?.askPrice ?? null;
  return {
    occ,
    streamerSymbol,
    bid,
    ask,
    mid: midPrice(bid, ask),
    delta: snapshot?.greeks?.delta ?? null,
    iv: snapshot?.greeks?.volatility ?? null,
  };
};

export const computeExpectedMove = (
  underlyingSymbol: string,
  underlyingPrice: number,
  expiration: RawChainExpiration,
  atmStrike: RawChainStrike,
  callSnapshot: MarketSnapshot | undefined,
  putSnapshot: MarketSnapshot | undefined,
): ExpectedMove => {
  const atmCall = buildLegQuote(atmStrike.call, atmStrike.callStreamerSymbol, callSnapshot);
  const atmPut = buildLegQuote(atmStrike.put, atmStrike.putStreamerSymbol, putSnapshot);
  const straddleMid =
    atmCall.mid !== null && atmPut.mid !== null ? atmCall.mid + atmPut.mid : null;

  const ivs = [atmCall.iv, atmPut.iv].filter((v): v is number => v !== null);
  const iv = ivs.length > 0 ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
  const dte = expiration.daysToExpiration;
  const ivImpliedMove =
    iv !== null && dte > 0 ? underlyingPrice * iv * Math.sqrt(dte / 365) : null;

  return {
    underlyingSymbol,
    underlyingPrice,
    expirationDate: expiration.expirationDate,
    daysToExpiration: dte,
    atmStrike: num(atmStrike.strikePrice),
    atmCall,
    atmPut,
    straddleMid,
    expectedMovePercent: straddleMid !== null ? straddleMid / underlyingPrice : null,
    upperBound: straddleMid !== null ? underlyingPrice + straddleMid : null,
    lowerBound: straddleMid !== null ? underlyingPrice - straddleMid : null,
    ivImpliedMove,
    impliedVolatility: iv,
  };
};
