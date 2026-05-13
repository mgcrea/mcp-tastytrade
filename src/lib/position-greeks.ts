// Aggregate per-position greeks into per-underlying and net portfolio totals.
// Position-delta convention: signedQuantity × multiplier × per-contract-greek
// (matches desk shorthand: a long call with delta 0.5 contributes +50 shares-equivalent).

import type { MarketSnapshot } from "../streaming/dxlink-snapshot.js";
import { toDxlink } from "../streaming/symbol.js";

export type RawPosition = {
  symbol: string;
  instrumentType?: string;
  underlyingSymbol?: string;
  quantity?: number | string;
  quantityDirection?: string;
  multiplier?: number | string;
  markPrice?: number | string;
  averageOpenPrice?: number | string;
  closePrice?: number | string;
};

export type PositionGreeks = {
  symbol: string;
  instrumentType: string | null;
  underlyingSymbol: string;
  quantity: number;
  signedQuantity: number;
  direction: string;
  multiplier: number;
  optionType: "Call" | "Put" | null;
  strikePrice: number | null;
  expirationDate: string | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  markPrice: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  iv: number | null;
  deltaContribution: number | null;
  gammaContribution: number | null;
  thetaContribution: number | null;
  vegaContribution: number | null;
};

export type Aggregates = { delta: number; gamma: number; theta: number; vega: number };

export type PositionGreeksReport = {
  accountNumber: string;
  asOf: string;
  byPosition: PositionGreeks[];
  byUnderlying: Record<string, Aggregates>;
  net: Aggregates;
  missingMarks: string[];
};

const OCC_PARSE = /^([A-Z][A-Z0-9.$/]{0,5})\s+(\d{6})([CP])(\d{8})$/;

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

export const parseOccDetails = (
  occ: string,
): { optionType: "Call" | "Put"; strike: number; expirationDate: string } | null => {
  const m = OCC_PARSE.exec(occ);
  if (!m) return null;
  const yy = m[2]!.slice(0, 2);
  const mm = m[2]!.slice(2, 4);
  const dd = m[2]!.slice(4, 6);
  return {
    optionType: m[3] === "C" ? "Call" : "Put",
    strike: Number(m[4]) / 1000,
    expirationDate: `20${yy}-${mm}-${dd}`,
  };
};

export const isActivePosition = (p: RawPosition): boolean => {
  const q = num(p.quantity);
  if (q === null || q === 0) return false;
  if (p.quantityDirection === "Zero") return false;
  return true;
};

export const isOptionPosition = (p: RawPosition): boolean =>
  p.instrumentType === "Equity Option";

const dirSign = (d: string | undefined): number => (d === "Short" ? -1 : 1);

const addAgg = (a: Aggregates, b: Partial<Aggregates>): Aggregates => ({
  delta: a.delta + (b.delta ?? 0),
  gamma: a.gamma + (b.gamma ?? 0),
  theta: a.theta + (b.theta ?? 0),
  vega: a.vega + (b.vega ?? 0),
});

const emptyAgg = (): Aggregates => ({ delta: 0, gamma: 0, theta: 0, vega: 0 });

export const enrichPositions = (
  positions: RawPosition[],
  snapshots: MarketSnapshot[],
  accountNumber: string,
  now: () => Date = () => new Date(),
): PositionGreeksReport => {
  const snapByDx = new Map(snapshots.map((s) => [s.dxlinkSymbol, s] as const));
  const byUnderlying: Record<string, Aggregates> = {};
  let net: Aggregates = emptyAgg();
  const missingMarks: string[] = [];

  const byPosition: PositionGreeks[] = positions.filter(isActivePosition).map((p) => {
    const quantity = num(p.quantity) ?? 0;
    const direction = p.quantityDirection ?? "Long";
    const isOption = isOptionPosition(p);
    const isEquity = p.instrumentType === "Equity";
    const multiplier = num(p.multiplier) ?? (isOption ? 100 : 1);
    const signedQuantity = quantity * dirSign(direction);

    const occ = isOption ? parseOccDetails(p.symbol) : null;
    const dx = isOption ? toDxlink(p.symbol) : null;
    const snap = dx ? snapByDx.get(dx) : undefined;

    const bid = snap?.quote?.bidPrice ?? null;
    const ask = snap?.quote?.askPrice ?? null;
    const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;

    const perContract = isOption
      ? {
          delta: snap?.greeks?.delta ?? null,
          gamma: snap?.greeks?.gamma ?? null,
          theta: snap?.greeks?.theta ?? null,
          vega: snap?.greeks?.vega ?? null,
          rho: snap?.greeks?.rho ?? null,
          iv: snap?.greeks?.volatility ?? null,
        }
      : isEquity
        ? { delta: 1, gamma: 0, theta: 0, vega: 0, rho: 0, iv: null }
        : { delta: null, gamma: null, theta: null, vega: null, rho: null, iv: null };

    const contrib = (g: number | null): number | null =>
      g === null ? null : signedQuantity * multiplier * g;
    const deltaC = contrib(perContract.delta);
    const gammaC = contrib(perContract.gamma);
    const thetaC = contrib(perContract.theta);
    const vegaC = contrib(perContract.vega);

    const u = p.underlyingSymbol ?? p.symbol;
    const hasAnyContribution =
      deltaC !== null || gammaC !== null || thetaC !== null || vegaC !== null;
    if (hasAnyContribution) {
      const cur = byUnderlying[u] ?? emptyAgg();
      const inc: Partial<Aggregates> = {
        delta: deltaC ?? 0,
        gamma: gammaC ?? 0,
        theta: thetaC ?? 0,
        vega: vegaC ?? 0,
      };
      byUnderlying[u] = addAgg(cur, inc);
      net = addAgg(net, inc);
    } else if (isOption) {
      missingMarks.push(p.symbol);
    }

    return {
      symbol: p.symbol,
      instrumentType: p.instrumentType ?? null,
      underlyingSymbol: u,
      quantity,
      signedQuantity,
      direction,
      multiplier,
      optionType: occ?.optionType ?? null,
      strikePrice: occ?.strike ?? null,
      expirationDate: occ?.expirationDate ?? null,
      bid,
      ask,
      mid,
      markPrice: num(p.markPrice),
      delta: perContract.delta,
      gamma: perContract.gamma,
      theta: perContract.theta,
      vega: perContract.vega,
      rho: perContract.rho,
      iv: perContract.iv,
      deltaContribution: deltaC,
      gammaContribution: gammaC,
      thetaContribution: thetaC,
      vegaContribution: vegaC,
    };
  });

  return {
    accountNumber,
    asOf: now().toISOString(),
    byPosition,
    byUnderlying,
    net,
    missingMarks,
  };
};
