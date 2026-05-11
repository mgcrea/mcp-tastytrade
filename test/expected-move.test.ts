import { describe, expect, it } from "vitest";

import {
  buildLegQuote,
  computeExpectedMove,
  pickAtmStrike,
  pickExpiration,
} from "../src/lib/expected-move.js";
import type { RawChainRoot } from "../src/lib/option-chain.js";
import type { MarketSnapshot } from "../src/streaming/dxlink-snapshot.js";

const ROOT: RawChainRoot = {
  underlyingSymbol: "IWM",
  rootSymbol: "IWM",
  optionChainType: "Standard",
  sharesPerContract: 100,
  expirations: [
    {
      expirationDate: "2026-05-15",
      daysToExpiration: 4,
      expirationType: "Weekly",
      strikes: [
        {
          strikePrice: "200.0",
          call: "IWM   260515C00200000",
          callStreamerSymbol: ".IWM260515C200",
          put: "IWM   260515P00200000",
          putStreamerSymbol: ".IWM260515P200",
        },
      ],
    },
    {
      expirationDate: "2026-05-29",
      daysToExpiration: 18,
      expirationType: "Regular",
      strikes: [
        {
          strikePrice: "280.0",
          call: "IWM   260529C00280000",
          callStreamerSymbol: ".IWM260529C280",
          put: "IWM   260529P00280000",
          putStreamerSymbol: ".IWM260529P280",
        },
        {
          strikePrice: "285.0",
          call: "IWM   260529C00285000",
          callStreamerSymbol: ".IWM260529C285",
          put: "IWM   260529P00285000",
          putStreamerSymbol: ".IWM260529P285",
        },
        {
          strikePrice: "290.0",
          call: "IWM   260529C00290000",
          callStreamerSymbol: ".IWM260529C290",
          put: "IWM   260529P00290000",
          putStreamerSymbol: ".IWM260529P290",
        },
      ],
    },
    {
      expirationDate: "2026-06-19",
      daysToExpiration: 39,
      expirationType: "Regular",
      strikes: [
        {
          strikePrice: "285.0",
          call: "IWM   260619C00285000",
          callStreamerSymbol: ".IWM260619C285",
          put: "IWM   260619P00285000",
          putStreamerSymbol: ".IWM260619P285",
        },
      ],
    },
  ],
};

const snapshot = (
  sym: string,
  q: { bid?: number; ask?: number; delta?: number; iv?: number } = {},
): MarketSnapshot => ({
  symbol: sym,
  dxlinkSymbol: sym,
  receivedAt: 1700000000000,
  quote:
    q.bid !== undefined || q.ask !== undefined
      ? {
          bidPrice: q.bid ?? null,
          askPrice: q.ask ?? null,
          bidSize: null,
          askSize: null,
          eventTime: null,
          eventTimeIso: null,
        }
      : null,
  greeks:
    q.delta !== undefined || q.iv !== undefined
      ? {
          price: null,
          volatility: q.iv ?? null,
          delta: q.delta ?? null,
          gamma: null,
          theta: null,
          rho: null,
          vega: null,
        }
      : null,
});

describe("pickExpiration", () => {
  it("returns exact match by expirationDate", () => {
    expect(pickExpiration(ROOT, { expirationDate: "2026-05-29" }).daysToExpiration).toBe(18);
  });

  it("throws on missing expirationDate with available dates listed", () => {
    expect(() => pickExpiration(ROOT, { expirationDate: "2099-01-01" })).toThrow(
      /Available: 2026-05-15, 2026-05-29, 2026-06-19/,
    );
  });

  it("returns nearest match by daysToExpiration", () => {
    expect(pickExpiration(ROOT, { daysToExpiration: 20 }).expirationDate).toBe("2026-05-29");
    expect(pickExpiration(ROOT, { daysToExpiration: 0 }).expirationDate).toBe("2026-05-15");
    expect(pickExpiration(ROOT, { daysToExpiration: 100 }).expirationDate).toBe("2026-06-19");
  });

  it("throws when no expirationDate or daysToExpiration is given", () => {
    expect(() => pickExpiration(ROOT, {})).toThrow(/Need expirationDate or daysToExpiration/);
  });
});

describe("pickAtmStrike", () => {
  it("picks the strike closest to spot", () => {
    const may29 = ROOT.expirations[1]!;
    expect(pickAtmStrike(may29, 286).strikePrice).toBe("285.0");
    expect(pickAtmStrike(may29, 282).strikePrice).toBe("280.0");
    expect(pickAtmStrike(may29, 289).strikePrice).toBe("290.0");
  });
});

describe("buildLegQuote", () => {
  it("returns nulls when snapshot missing", () => {
    const leg = buildLegQuote("OCC", ".STREAM", undefined);
    expect(leg).toEqual({
      occ: "OCC",
      streamerSymbol: ".STREAM",
      bid: null,
      ask: null,
      mid: null,
      delta: null,
      iv: null,
    });
  });

  it("computes mid from bid/ask", () => {
    const leg = buildLegQuote("OCC", ".STREAM", snapshot(".STREAM", { bid: 1.0, ask: 1.2 }));
    expect(leg.mid).toBeCloseTo(1.1);
  });

  it("leaves mid null when one side is missing", () => {
    const leg = buildLegQuote("OCC", ".STREAM", snapshot(".STREAM", { bid: 1.0 }));
    expect(leg.mid).toBeNull();
  });
});

describe("computeExpectedMove", () => {
  const exp = ROOT.expirations[1]!;
  const atm = exp.strikes[1]!; // 285

  it("computes straddle, bounds, and IV-implied move", () => {
    const callSnap = snapshot(".IWM260529C285", { bid: 3.0, ask: 3.2, iv: 0.25, delta: 0.5 });
    const putSnap = snapshot(".IWM260529P285", { bid: 2.8, ask: 3.0, iv: 0.27, delta: -0.5 });
    const result = computeExpectedMove("IWM", 285, exp, atm, callSnap, putSnap);

    expect(result.atmStrike).toBe(285);
    expect(result.atmCall.mid).toBeCloseTo(3.1);
    expect(result.atmPut.mid).toBeCloseTo(2.9);
    expect(result.straddleMid).toBeCloseTo(6.0);
    expect(result.upperBound).toBeCloseTo(291.0);
    expect(result.lowerBound).toBeCloseTo(279.0);
    expect(result.expectedMovePercent).toBeCloseTo(6 / 285);
    expect(result.impliedVolatility).toBeCloseTo(0.26);
    // 285 * 0.26 * sqrt(18/365)
    expect(result.ivImpliedMove).toBeCloseTo(285 * 0.26 * Math.sqrt(18 / 365));
    expect(result.daysToExpiration).toBe(18);
  });

  it("leaves derived fields null when quotes are missing", () => {
    const result = computeExpectedMove("IWM", 285, exp, atm, undefined, undefined);
    expect(result.straddleMid).toBeNull();
    expect(result.upperBound).toBeNull();
    expect(result.lowerBound).toBeNull();
    expect(result.expectedMovePercent).toBeNull();
    expect(result.ivImpliedMove).toBeNull();
    expect(result.impliedVolatility).toBeNull();
  });
});
