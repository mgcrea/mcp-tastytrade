import { describe, expect, it } from "vitest";

import { enrichPositions, parseOccDetails, type RawPosition } from "../src/lib/position-greeks.js";
import type { MarketSnapshot } from "../src/streaming/dxlink-snapshot.js";

const optionSnap = (
  dxSym: string,
  q: { bid: number; ask: number },
  g: { delta: number; gamma?: number; theta?: number; vega?: number; rho?: number; iv?: number },
): MarketSnapshot => ({
  symbol: dxSym,
  dxlinkSymbol: dxSym,
  receivedAt: 1700000000000,
  quote: {
    bidPrice: q.bid,
    askPrice: q.ask,
    bidSize: null,
    askSize: null,
    eventTime: null,
    eventTimeIso: null,
  },
  greeks: {
    price: null,
    volatility: g.iv ?? null,
    delta: g.delta,
    gamma: g.gamma ?? 0,
    theta: g.theta ?? 0,
    vega: g.vega ?? 0,
    rho: g.rho ?? 0,
  },
});

const fixedNow = () => new Date("2026-05-13T12:00:00Z");

describe("parseOccDetails", () => {
  it("parses standard OCC option symbols", () => {
    expect(parseOccDetails("AAPL  260117C00200000")).toEqual({
      optionType: "Call",
      strike: 200,
      expirationDate: "2026-01-17",
    });
    expect(parseOccDetails("IWM   260529P00285500")).toEqual({
      optionType: "Put",
      strike: 285.5,
      expirationDate: "2026-05-29",
    });
  });

  it("returns null for non-option symbols", () => {
    expect(parseOccDetails("AAPL")).toBeNull();
    expect(parseOccDetails("XYZ123")).toBeNull();
  });
});

describe("enrichPositions", () => {
  it("computes per-position contributions and aggregates", () => {
    const positions: RawPosition[] = [
      {
        symbol: "AAPL  261218C00200000",
        instrumentType: "Equity Option",
        underlyingSymbol: "AAPL",
        quantity: 2,
        quantityDirection: "Long",
        multiplier: 100,
      },
      {
        symbol: "AAPL  261218P00180000",
        instrumentType: "Equity Option",
        underlyingSymbol: "AAPL",
        quantity: 1,
        quantityDirection: "Short",
        multiplier: 100,
      },
      {
        symbol: "NVDA",
        instrumentType: "Equity",
        underlyingSymbol: "NVDA",
        quantity: 50,
        quantityDirection: "Long",
        multiplier: 1,
      },
    ];

    const snaps = [
      optionSnap(".AAPL261218C200", { bid: 5, ask: 5.2 }, { delta: 0.5, theta: -0.05, vega: 0.1 }),
      optionSnap(
        ".AAPL261218P180",
        { bid: 3, ask: 3.1 },
        { delta: -0.4, theta: -0.03, vega: 0.08 },
      ),
    ];

    const report = enrichPositions(positions, snaps, "5WX12345", fixedNow);

    expect(report.byPosition).toHaveLength(3);

    // AAPL long calls: 2 × 100 × 0.5 = 100 delta
    const longCall = report.byPosition.find((p) => p.symbol === "AAPL  261218C00200000")!;
    expect(longCall.deltaContribution).toBeCloseTo(100);
    expect(longCall.thetaContribution).toBeCloseTo(-10);
    expect(longCall.optionType).toBe("Call");
    expect(longCall.strikePrice).toBe(200);
    expect(longCall.expirationDate).toBe("2026-12-18");

    // AAPL short puts: -1 × 100 × -0.4 = +40 delta
    const shortPut = report.byPosition.find((p) => p.symbol === "AAPL  261218P00180000")!;
    expect(shortPut.signedQuantity).toBe(-1);
    expect(shortPut.deltaContribution).toBeCloseTo(40);

    // NVDA equity: 50 × 1 × 1 = 50 delta
    const equity = report.byPosition.find((p) => p.symbol === "NVDA")!;
    expect(equity.deltaContribution).toBe(50);
    expect(equity.gammaContribution).toBe(0);
    expect(equity.optionType).toBeNull();

    // Per-underlying
    expect(report.byUnderlying.AAPL?.delta).toBeCloseTo(140);
    expect(report.byUnderlying.NVDA?.delta).toBe(50);

    // Net
    expect(report.net.delta).toBeCloseTo(190);

    expect(report.asOf).toBe("2026-05-13T12:00:00.000Z");
    expect(report.missingMarks).toEqual([]);
  });

  it("flags option positions with missing snapshots in missingMarks", () => {
    const positions: RawPosition[] = [
      {
        symbol: "TSLA  261218C00300000",
        instrumentType: "Equity Option",
        underlyingSymbol: "TSLA",
        quantity: 1,
        quantityDirection: "Long",
        multiplier: 100,
      },
    ];
    const report = enrichPositions(positions, [], "5WX12345", fixedNow);
    expect(report.missingMarks).toEqual(["TSLA  261218C00300000"]);
    expect(report.byPosition[0]?.deltaContribution).toBeNull();
    expect(report.net.delta).toBe(0);
  });

  it("skips zero-quantity / 'Zero' direction positions", () => {
    const positions: RawPosition[] = [
      {
        symbol: "AAPL",
        instrumentType: "Equity",
        underlyingSymbol: "AAPL",
        quantity: 0,
        quantityDirection: "Zero",
      },
      {
        symbol: "TSLA",
        instrumentType: "Equity",
        underlyingSymbol: "TSLA",
        quantity: 100,
        quantityDirection: "Zero",
      },
    ];
    const report = enrichPositions(positions, [], "5WX12345", fixedNow);
    expect(report.byPosition).toEqual([]);
  });

  it("handles numeric fields supplied as strings", () => {
    const positions: RawPosition[] = [
      {
        symbol: "AAPL",
        instrumentType: "Equity",
        underlyingSymbol: "AAPL",
        quantity: "10",
        quantityDirection: "Long",
        multiplier: "1",
        markPrice: "175.5",
      },
    ];
    const report = enrichPositions(positions, [], "5WX12345", fixedNow);
    expect(report.byPosition[0]?.quantity).toBe(10);
    expect(report.byPosition[0]?.markPrice).toBe(175.5);
    expect(report.net.delta).toBe(10);
  });
});
