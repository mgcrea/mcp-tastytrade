import { describe, expect, it } from "vitest";

import { toCamelKeys, toKebabKeys } from "../src/lib/case.js";

describe("case transforms", () => {
  it("converts camelCase keys to kebab-case", () => {
    expect(toKebabKeys({ accountNumber: "5WX", timeInForce: "GTC" })).toEqual({
      "account-number": "5WX",
      "time-in-force": "GTC",
    });
  });

  it("converts kebab-case keys back to camelCase", () => {
    expect(toCamelKeys({ "account-number": "5WX", "time-in-force": "GTC" })).toEqual({
      accountNumber: "5WX",
      timeInForce: "GTC",
    });
  });

  it("recurses into nested objects and arrays", () => {
    const input = { topLevel: { childKey: [{ leafKey: 1 }, { leafKey: 2 }] } };
    const kebab = toKebabKeys(input);
    expect(kebab).toEqual({ "top-level": { "child-key": [{ "leaf-key": 1 }, { "leaf-key": 2 }] } });
    expect(toCamelKeys(kebab)).toEqual(input);
  });

  it("does not mutate primitive values", () => {
    expect(toKebabKeys({ aB: null, cD: 0, eF: false, gH: "x" })).toEqual({
      "a-b": null,
      "c-d": 0,
      "e-f": false,
      "g-h": "x",
    });
  });

  it("does not transform Date / class instances", () => {
    const date = new Date(0);
    const out = toKebabKeys({ aB: date }) as { "a-b": Date };
    expect(out["a-b"]).toBe(date);
  });
});
