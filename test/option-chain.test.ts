import { describe, expect, it } from "vitest";

import {
  isFilterEmpty,
  type RawChainRoot,
  sliceChain,
  summarizeChain,
} from "../src/lib/option-chain.js";

const FIXTURE: RawChainRoot = {
  underlyingSymbol: "IWM",
  rootSymbol: "IWM",
  optionChainType: "Standard",
  sharesPerContract: 100,
  expirations: [
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
        {
          strikePrice: "295.0",
          call: "IWM   260529C00295000",
          callStreamerSymbol: ".IWM260529C295",
          put: "IWM   260529P00295000",
          putStreamerSymbol: ".IWM260529P295",
        },
        {
          strikePrice: "300.0",
          call: "IWM   260529C00300000",
          callStreamerSymbol: ".IWM260529C300",
          put: "IWM   260529P00300000",
          putStreamerSymbol: ".IWM260529P300",
        },
      ],
    },
    {
      expirationDate: "2026-06-19",
      daysToExpiration: 39,
      expirationType: "Regular",
      strikes: [
        {
          strikePrice: "290.0",
          call: "IWM   260619C00290000",
          callStreamerSymbol: ".IWM260619C290",
          put: "IWM   260619P00290000",
          putStreamerSymbol: ".IWM260619P290",
        },
        {
          strikePrice: "300.0",
          call: "IWM   260619C00300000",
          callStreamerSymbol: ".IWM260619C300",
          put: "IWM   260619P00300000",
          putStreamerSymbol: ".IWM260619P300",
        },
      ],
    },
  ],
};

describe("summarizeChain", () => {
  it("returns one row per expiration with strike count + min/max", () => {
    const s = summarizeChain(FIXTURE);
    expect(s.underlyingSymbol).toBe("IWM");
    expect(s.expirations).toHaveLength(2);
    expect(s.expirations[0]).toEqual({
      expirationDate: "2026-05-29",
      daysToExpiration: 18,
      expirationType: "Regular",
      strikeCount: 5,
      minStrike: 280,
      maxStrike: 300,
    });
  });

  it("produces a much smaller payload than the raw chain", () => {
    const summary = JSON.stringify(summarizeChain(FIXTURE)).length;
    const raw = JSON.stringify(FIXTURE).length;
    expect(summary).toBeLessThan(raw / 3);
  });
});

describe("sliceChain", () => {
  it("filters by expirationDate", () => {
    const r = sliceChain(FIXTURE, { expirationDate: "2026-05-29" });
    const expirations = new Set(r.legs.map((l) => l.expirationDate));
    expect(expirations).toEqual(new Set(["2026-05-29"]));
    expect(r.legs).toHaveLength(10); // 5 strikes × 2 (call+put)
  });

  it("filters by strikeMin/strikeMax", () => {
    const r = sliceChain(FIXTURE, { expirationDate: "2026-05-29", strikeMin: 285, strikeMax: 295 });
    const strikes = r.legs.map((l) => l.strikePrice);
    expect(new Set(strikes)).toEqual(new Set([285, 290, 295]));
  });

  it("filters by optionType", () => {
    const r = sliceChain(FIXTURE, { expirationDate: "2026-05-29", optionType: "call" });
    expect(r.legs.every((l) => l.optionType === "Call")).toBe(true);
    expect(r.legs).toHaveLength(5);
  });

  it("strikeAround picks N nearest strikes to a center", () => {
    const r = sliceChain(FIXTURE, {
      expirationDate: "2026-05-29",
      strikeAround: { center: 292, count: 3 },
      optionType: "call",
    });
    // 3 strikes nearest to 292: 290 (Δ2), 295 (Δ3), 285 (Δ7) → sorted ascending: 285, 290, 295
    expect(r.legs.map((l) => l.strikePrice)).toEqual([285, 290, 295]);
  });

  it("filters by daysToExpirationMax", () => {
    const r = sliceChain(FIXTURE, { daysToExpirationMax: 30 });
    const expirations = new Set(r.legs.map((l) => l.expirationDate));
    expect(expirations).toEqual(new Set(["2026-05-29"]));
  });

  it("each leg carries both OCC and DXLink streamer symbols", () => {
    const r = sliceChain(FIXTURE, {
      expirationDate: "2026-05-29",
      strikeMin: 300,
      optionType: "call",
    });
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0]).toMatchObject({
      strikePrice: 300,
      optionType: "Call",
      occ: "IWM   260529C00300000",
      streamerSymbol: ".IWM260529C300",
    });
  });
});

describe("isFilterEmpty", () => {
  it("recognizes empty filter", () => {
    expect(isFilterEmpty({})).toBe(true);
  });
  it("recognizes any field as non-empty", () => {
    expect(isFilterEmpty({ expirationDate: "2026-05-29" })).toBe(false);
    expect(isFilterEmpty({ strikeMin: 100 })).toBe(false);
    expect(isFilterEmpty({ optionType: "call" })).toBe(false);
  });
});
