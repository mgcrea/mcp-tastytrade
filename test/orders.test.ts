import { describe, expect, it } from "vitest";

import { CANCELLABLE_STATUSES, type RawOpenOrder, slimOrder } from "../src/tools/orders.js";

describe("CANCELLABLE_STATUSES", () => {
  it("includes the working states", () => {
    expect(CANCELLABLE_STATUSES).toEqual(["Received", "Live", "Routed"]);
  });
});

describe("slimOrder", () => {
  it("projects the fields the cancel preview needs and counts legs", () => {
    const order: RawOpenOrder = {
      id: 42,
      status: "Live",
      underlyingSymbol: "AAPL",
      orderType: "Limit",
      timeInForce: "Day",
      price: "1.50",
      priceEffect: "Debit",
      legs: [{ symbol: "AAPL  261218C00200000" }, { symbol: "AAPL  261218C00210000" }],
    };
    expect(slimOrder(order)).toEqual({
      id: 42,
      status: "Live",
      underlyingSymbol: "AAPL",
      orderType: "Limit",
      timeInForce: "Day",
      price: "1.50",
      priceEffect: "Debit",
      legCount: 2,
    });
  });

  it("returns nulls and legCount=0 for an empty-ish order", () => {
    expect(slimOrder({})).toEqual({
      id: null,
      status: null,
      underlyingSymbol: null,
      orderType: null,
      timeInForce: null,
      price: null,
      priceEffect: null,
      legCount: 0,
    });
  });
});
