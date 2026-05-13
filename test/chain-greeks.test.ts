import { describe, expect, it } from "vitest";

import { enrichLeg } from "../src/lib/chain-greeks.js";
import type { EnrichedLeg } from "../src/lib/chain-greeks.js";
import type { ChainLeg } from "../src/lib/option-chain.js";
import type { MarketSnapshot } from "../src/streaming/dxlink-snapshot.js";
import { extractEarnings, pickStrikeByDelta } from "../src/tools/instruments.js";

const leg = (overrides: Partial<ChainLeg> = {}): ChainLeg => ({
  expirationDate: "2026-05-29",
  daysToExpiration: 16,
  strikePrice: 100,
  optionType: "Call",
  occ: "X     260529C00100000",
  streamerSymbol: ".X260529C100",
  ...overrides,
});

const snap = (dxSym: string, bid: number, ask: number, delta: number | null): MarketSnapshot => ({
  symbol: dxSym,
  dxlinkSymbol: dxSym,
  receivedAt: 0,
  quote: {
    bidPrice: bid,
    askPrice: ask,
    bidSize: null,
    askSize: null,
    eventTime: null,
    eventTimeIso: null,
  },
  greeks:
    delta === null
      ? null
      : { price: null, volatility: 0.2, delta, gamma: 0.01, theta: -0.02, vega: 0.1, rho: 0.01 },
});

describe("enrichLeg", () => {
  it("merges quote + greeks into a leg", () => {
    const out = enrichLeg(leg(), snap(".X260529C100", 1.0, 1.2, 0.5));
    expect(out.bid).toBe(1);
    expect(out.ask).toBe(1.2);
    expect(out.mid).toBeCloseTo(1.1);
    expect(out.delta).toBe(0.5);
    expect(out.iv).toBe(0.2);
  });

  it("returns nulls when snapshot missing", () => {
    const out = enrichLeg(leg(), undefined);
    expect(out.bid).toBeNull();
    expect(out.mid).toBeNull();
    expect(out.delta).toBeNull();
  });
});

describe("pickStrikeByDelta", () => {
  const legs: EnrichedLeg[] = [
    {
      ...leg({ strikePrice: 95, optionType: "Call" }),
      bid: 6,
      ask: 6.2,
      mid: 6.1,
      delta: 0.65,
      gamma: null,
      theta: null,
      vega: null,
      rho: null,
      iv: null,
    },
    {
      ...leg({ strikePrice: 100, optionType: "Call" }),
      bid: 3,
      ask: 3.2,
      mid: 3.1,
      delta: 0.5,
      gamma: null,
      theta: null,
      vega: null,
      rho: null,
      iv: null,
    },
    {
      ...leg({ strikePrice: 105, optionType: "Call" }),
      bid: 1,
      ask: 1.2,
      mid: 1.1,
      delta: 0.3,
      gamma: null,
      theta: null,
      vega: null,
      rho: null,
      iv: null,
    },
    {
      ...leg({ strikePrice: 95, optionType: "Put" }),
      bid: 1,
      ask: 1.2,
      mid: 1.1,
      delta: -0.3,
      gamma: null,
      theta: null,
      vega: null,
      rho: null,
      iv: null,
    },
    {
      ...leg({ strikePrice: 100, optionType: "Put" }),
      bid: 3,
      ask: 3.2,
      mid: 3.1,
      delta: -0.5,
      gamma: null,
      theta: null,
      vega: null,
      rho: null,
      iv: null,
    },
    {
      ...leg({ strikePrice: 105, optionType: "Put" }),
      bid: 6,
      ask: 6.2,
      mid: 6.1,
      delta: -0.65,
      gamma: null,
      theta: null,
      vega: null,
      rho: null,
      iv: null,
    },
  ];

  it("picks the call closest to a positive target delta", () => {
    const m = pickStrikeByDelta(legs, 0.32);
    expect(m.leg?.strikePrice).toBe(105);
    expect(m.leg?.optionType).toBe("Call");
    expect(m.deltaDiff).toBeCloseTo(0.02);
  });

  it("picks the put closest to a negative target delta", () => {
    const m = pickStrikeByDelta(legs, -0.5);
    expect(m.leg?.strikePrice).toBe(100);
    expect(m.leg?.optionType).toBe("Put");
    expect(m.deltaDiff).toBeCloseTo(0);
  });

  it("returns null leg when no candidates have delta", () => {
    const m = pickStrikeByDelta([], 0.5);
    expect(m.leg).toBeNull();
    expect(m.deltaDiff).toBeNull();
  });
});

describe("extractEarnings", () => {
  it("extracts nested earnings fields", () => {
    expect(
      extractEarnings({
        symbol: "AAPL",
        earnings: {
          expectedReportDate: "2026-07-30",
          timeOfDay: "After Market",
          estimatedEarnings: 2.05,
        },
      }),
    ).toEqual({
      symbol: "AAPL",
      expectedReportDate: "2026-07-30",
      timeOfDay: "After Market",
      estimatedEarnings: 2.05,
    });
  });

  it("falls back to top-level fields when no nested earnings object", () => {
    expect(
      extractEarnings({
        symbol: "TSLA",
        earningsExpectedReportDate: "2026-04-22",
      }),
    ).toEqual({
      symbol: "TSLA",
      expectedReportDate: "2026-04-22",
      timeOfDay: null,
      estimatedEarnings: null,
    });
  });

  it("returns nulls when no earnings data present", () => {
    expect(extractEarnings({ symbol: "XYZ" })).toEqual({
      symbol: "XYZ",
      expectedReportDate: null,
      timeOfDay: null,
      estimatedEarnings: null,
    });
  });
});
