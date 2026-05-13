import { describe, expect, it } from "vitest";

import { DiagnosticsRecorder } from "../src/lib/diagnostics.js";

const fixedClock = (start: number): (() => Date) => {
  let t = start;
  return () => new Date((t += 1000));
};

describe("DiagnosticsRecorder", () => {
  it("records entries with ISO ts, level, and formatted message", () => {
    const rec = new DiagnosticsRecorder(10, fixedClock(1700000000000));
    rec.log("warn", ["dxlink:", "UNAUTHORIZED"]);
    const entries = rec.recent();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("warn");
    expect(entries[0]?.message).toBe("dxlink: UNAUTHORIZED");
    expect(entries[0]?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rolls when capacity is exceeded, keeping the most recent N", () => {
    const rec = new DiagnosticsRecorder(3);
    for (let i = 0; i < 5; i++) rec.log("debug", [`line ${i}`]);
    const entries = rec.recent();
    expect(entries.map((e) => e.message)).toEqual(["line 2", "line 3", "line 4"]);
    expect(rec.size()).toBe(3);
  });

  it("recent(limit) returns the trailing slice", () => {
    const rec = new DiagnosticsRecorder(10);
    for (let i = 0; i < 5; i++) rec.log("debug", [`line ${i}`]);
    expect(rec.recent(2).map((e) => e.message)).toEqual(["line 3", "line 4"]);
    expect(rec.recent(0)).toEqual([]);
  });

  it("formats Error objects as their message, not [object Object]", () => {
    const rec = new DiagnosticsRecorder();
    rec.log("error", ["dxlink: giving up", new Error("token rejected")]);
    expect(rec.recent()[0]?.message).toBe("dxlink: giving up token rejected");
  });

  it("never throws on non-serializable arguments", () => {
    const rec = new DiagnosticsRecorder();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => rec.log("debug", ["weird", circular])).not.toThrow();
    expect(rec.size()).toBe(1);
  });
});
