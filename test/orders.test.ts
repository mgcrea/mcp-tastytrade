import { describe, expect, it } from "vitest";

import {
  CANCELLABLE_STATUSES,
  ComplexOrderRequestSchema,
  type RawOpenOrder,
  slimOrder,
} from "../src/tools/orders.js";

const entry = {
  timeInForce: "Day" as const,
  orderType: "Market" as const,
  legs: [
    {
      instrumentType: "Equity",
      symbol: "SPY",
      quantity: 1,
      action: "Buy to Open" as const,
    },
  ],
};

const takeProfit = {
  timeInForce: "GTC" as const,
  orderType: "Limit" as const,
  price: 600,
  priceEffect: "Credit" as const,
  legs: [
    {
      instrumentType: "Equity",
      symbol: "SPY",
      quantity: 1,
      action: "Sell to Close" as const,
    },
  ],
};

const stopLoss = {
  timeInForce: "GTC" as const,
  orderType: "Stop" as const,
  stopTrigger: 540,
  legs: [
    {
      instrumentType: "Equity",
      symbol: "SPY",
      quantity: 1,
      action: "Sell to Close" as const,
    },
  ],
};

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

describe("ComplexOrderRequestSchema", () => {
  it("accepts a valid OTOCO bracket (entry + take-profit + stop-loss)", () => {
    const parsed = ComplexOrderRequestSchema.safeParse({
      type: "OTOCO",
      triggerOrder: entry,
      orders: [takeProfit, stopLoss],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects OTOCO without a triggerOrder", () => {
    const parsed = ComplexOrderRequestSchema.safeParse({
      type: "OTOCO",
      orders: [takeProfit, stopLoss],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message.includes("requires triggerOrder"))).toBe(
        true,
      );
    }
  });

  it("rejects OTOCO with only one child order", () => {
    const parsed = ComplexOrderRequestSchema.safeParse({
      type: "OTOCO",
      triggerOrder: entry,
      orders: [stopLoss],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message.includes("exactly 2 child orders"))).toBe(
        true,
      );
    }
  });

  it("accepts an OCO pair attached to an existing position", () => {
    const parsed = ComplexOrderRequestSchema.safeParse({
      type: "OCO",
      orders: [takeProfit, stopLoss],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects OCO that includes a triggerOrder", () => {
    const parsed = ComplexOrderRequestSchema.safeParse({
      type: "OCO",
      triggerOrder: entry,
      orders: [takeProfit, stopLoss],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) => i.message.includes("OCO must not include triggerOrder")),
      ).toBe(true);
    }
  });

  it("accepts OTO with a triggerOrder and one follow-on", () => {
    const parsed = ComplexOrderRequestSchema.safeParse({
      type: "OTO",
      triggerOrder: entry,
      orders: [stopLoss],
    });
    expect(parsed.success).toBe(true);
  });
});
