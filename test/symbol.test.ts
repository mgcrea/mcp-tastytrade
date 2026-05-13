import { describe, expect, it } from "vitest";

import {
  dxlinkToOcc,
  isDxlinkOption,
  isOccOption,
  isOption,
  occToDxlink,
  toDxlink,
  toOcc,
} from "../src/streaming/symbol.js";

describe("symbol helpers", () => {
  describe("isOccOption", () => {
    it("matches OCC option symbols with various root lengths", () => {
      expect(isOccOption("IWM   260529C00300000")).toBe(true);
      expect(isOccOption("AAPL  260620C00200000")).toBe(true);
      expect(isOccOption("SPY   260516P00580000")).toBe(true);
      expect(isOccOption("F     260117C00012500")).toBe(true);
    });

    it("matches OCC with fractional strikes", () => {
      // 287.5 strike → 00287500
      expect(isOccOption("SPY   260516C00287500")).toBe(true);
    });

    it("rejects non-OCC strings", () => {
      expect(isOccOption("AAPL")).toBe(false);
      expect(isOccOption(".SPY260516C580")).toBe(false);
      expect(isOccOption("IWM-260529C00300000")).toBe(false);
      expect(isOccOption("")).toBe(false);
    });
  });

  describe("isDxlinkOption / isOption", () => {
    it("identifies DXLink option symbols (dot prefix)", () => {
      expect(isDxlinkOption(".IWM260529C300")).toBe(true);
      expect(isDxlinkOption(".SPY260516C287.5")).toBe(true);
      expect(isDxlinkOption("AAPL")).toBe(false);
    });

    it("treats either format as an option", () => {
      expect(isOption(".IWM260529C300")).toBe(true);
      expect(isOption("IWM   260529C00300000")).toBe(true);
      expect(isOption("AAPL")).toBe(false);
    });
  });

  describe("occToDxlink", () => {
    it("converts integer strikes", () => {
      expect(occToDxlink("IWM   260529C00300000")).toBe(".IWM260529C300");
      expect(occToDxlink("SPY   260516P00580000")).toBe(".SPY260516P580");
      expect(occToDxlink("F     260117C00012500")).toBe(".F260117C12.5");
    });

    it("converts fractional strikes", () => {
      expect(occToDxlink("SPY   260516C00287500")).toBe(".SPY260516C287.5");
      expect(occToDxlink("AAPL  260620C00200250")).toBe(".AAPL260620C200.25");
    });

    it("throws on non-OCC input", () => {
      expect(() => occToDxlink("AAPL")).toThrow(/Not an OCC option symbol/);
      expect(() => occToDxlink(".IWM260529C300")).toThrow();
    });
  });

  describe("toDxlink", () => {
    it("passes through DXLink symbols", () => {
      expect(toDxlink(".IWM260529C300")).toBe(".IWM260529C300");
      expect(toDxlink("AAPL")).toBe("AAPL");
    });
    it("converts OCC to DXLink", () => {
      expect(toDxlink("IWM   260529C00300000")).toBe(".IWM260529C300");
    });
  });

  describe("dxlinkToOcc", () => {
    it("converts integer strikes", () => {
      expect(dxlinkToOcc(".IWM260529C300")).toBe("IWM   260529C00300000");
      expect(dxlinkToOcc(".SPY260516P580")).toBe("SPY   260516P00580000");
      expect(dxlinkToOcc(".F260117C12.5")).toBe("F     260117C00012500");
    });

    it("converts fractional strikes", () => {
      expect(dxlinkToOcc(".SPY260516C287.5")).toBe("SPY   260516C00287500");
      expect(dxlinkToOcc(".AAPL260620C200.25")).toBe("AAPL  260620C00200250");
    });

    it("throws on non-DXLink input", () => {
      expect(() => dxlinkToOcc("AAPL")).toThrow(/Not a DXLink option symbol/);
      expect(() => dxlinkToOcc("IWM   260529C00300000")).toThrow();
    });
  });

  describe("toOcc", () => {
    it("passes through OCC and non-option symbols", () => {
      expect(toOcc("IWM   260529C00300000")).toBe("IWM   260529C00300000");
      expect(toOcc("AAPL")).toBe("AAPL");
    });
    it("converts DXLink options to OCC", () => {
      expect(toOcc(".IWM260529C300")).toBe("IWM   260529C00300000");
    });
  });
});
