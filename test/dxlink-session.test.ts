import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TastytradeHttpClient } from "../src/client/http.js";
import { DxlinkSession, type WSLike } from "../src/streaming/dxlink-session.js";

// ---- Fake WebSocket --------------------------------------------------------

type Listener = (...args: unknown[]) => void;

class FakeWS implements WSLike {
  sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, cb: Listener): unknown {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
    return this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }

  emit(event: string, ...args: unknown[]): void {
    const list = this.listeners.get(event);
    if (!list) return;
    for (const cb of list.slice()) cb(...args);
  }

  // Simulate the full happy-path handshake driven from the server side.
  driveHandshake(): void {
    this.emit("open");
    // SETUP message we sent → server echoes SETUP back
    this.emit("message", JSON.stringify({ type: "SETUP", channel: 0 }));
    // After we send AUTH, server replies AUTHORIZED
    this.emit("message", JSON.stringify({ type: "AUTH_STATE", channel: 0, state: "AUTHORIZED" }));
    // After CHANNEL_REQUEST, server replies CHANNEL_OPENED
    this.emit("message", JSON.stringify({ type: "CHANNEL_OPENED", channel: 3 }));
    // After FEED_SETUP, server replies FEED_CONFIG (using requested fields)
    this.emit(
      "message",
      JSON.stringify({
        type: "FEED_CONFIG",
        channel: 3,
        eventFields: {
          Quote: ["eventType", "eventSymbol", "bidPrice", "askPrice", "bidSize", "askSize", "time"],
          Greeks: [
            "eventType",
            "eventSymbol",
            "price",
            "volatility",
            "delta",
            "gamma",
            "theta",
            "rho",
            "vega",
          ],
        },
      }),
    );
  }

  // Run SETUP then deliver an UNAUTHORIZED AUTH_STATE (server-side auth reject).
  driveUnauthorized(): void {
    this.emit("open");
    this.emit("message", JSON.stringify({ type: "SETUP", channel: 0 }));
    this.emit(
      "message",
      JSON.stringify({ type: "AUTH_STATE", channel: 0, state: "UNAUTHORIZED" }),
    );
  }

  // Emit a Quote record for `symbol` with bid/ask, in COMPACT format.
  emitQuote(symbol: string, bid: number, ask: number): void {
    this.emit(
      "message",
      JSON.stringify({
        type: "FEED_DATA",
        channel: 3,
        data: [
          "Quote",
          ["Quote", symbol, bid, ask, 100, 100, Date.now()],
        ],
      }),
    );
  }

  parsed(): Record<string, unknown>[] {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

// ---- Test harness ----------------------------------------------------------

const stubFetch = vi.fn(
  async () =>
    new Response(JSON.stringify({ access_token: "t", expires_in: 900 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
) as unknown as typeof fetch;

const buildHttp = () =>
  new TastytradeHttpClient({
    baseUrl: "https://api.example.com",
    oauth: { clientSecret: "sec", refreshToken: "ref", scope: "read" },
    fetch: stubFetch,
  });

type Harness = {
  session: DxlinkSession;
  factory: ReturnType<typeof vi.fn>;
  sockets: FakeWS[];
  getTokenCalls: { count: number };
  invalidateOAuthCalls: { count: number };
};

const makeHarness = (
  opts: {
    idleTimeoutMs?: number;
    cacheTtlMs?: number;
    lingerMs?: number;
    maxUnauthorizedAttempts?: number;
    unauthorizedBackoffMs?: number;
  } = {},
): Harness => {
  const sockets: FakeWS[] = [];
  const factory = vi.fn(() => {
    const ws = new FakeWS();
    sockets.push(ws);
    return ws as WSLike;
  });
  const getTokenCalls = { count: 0 };
  const invalidateOAuthCalls = { count: 0 };
  const session = new DxlinkSession(buildHttp(), {
    idleTimeoutMs: opts.idleTimeoutMs ?? 60_000,
    cacheTtlMs: opts.cacheTtlMs ?? 1_000,
    lingerMs: opts.lingerMs ?? 50,
    defaultTimeoutMs: 1_000,
    maxUnauthorizedAttempts: opts.maxUnauthorizedAttempts ?? 3,
    unauthorizedBackoffMs: opts.unauthorizedBackoffMs ?? 10,
    wsFactory: factory as unknown as (url: string) => WSLike,
    getToken: async () => {
      getTokenCalls.count += 1;
      return { token: "tok", dxlinkUrl: "wss://dxlink.example/" };
    },
    invalidateOAuth: () => {
      invalidateOAuthCalls.count += 1;
    },
  });
  return { session, factory, sockets, getTokenCalls, invalidateOAuthCalls };
};

// Pump microtasks so async chains advance.
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

// ---- Tests -----------------------------------------------------------------

describe("DxlinkSession", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the WS and runs the full handshake on first snapshot", async () => {
    const { session, sockets } = makeHarness();
    const promise = session.snapshot(["AAPL"]);
    await flush(); // let ensureReady fire the wsFactory
    expect(sockets.length).toBe(1);
    const ws = sockets[0]!;
    ws.driveHandshake();
    await flush();
    ws.emitQuote("AAPL", 100, 101);
    const result = await promise;
    expect(result[0]?.quote?.bidPrice).toBe(100);
    expect(result[0]?.quote?.askPrice).toBe(101);
    await session.close();

    const types = ws.parsed().map((m) => m.type);
    expect(types).toContain("SETUP");
    expect(types).toContain("AUTH");
    expect(types).toContain("CHANNEL_REQUEST");
    expect(types).toContain("FEED_SETUP");
    expect(types).toContain("FEED_SUBSCRIPTION");
  });

  it("reuses the same WS across back-to-back calls", async () => {
    const { session, sockets, factory } = makeHarness();
    const p1 = session.snapshot(["AAPL"]);
    await flush();
    const ws = sockets[0]!;
    ws.driveHandshake();
    await flush();
    ws.emitQuote("AAPL", 100, 101);
    await p1;

    const p2 = session.snapshot(["AAPL"]);
    const out = await p2;
    expect(factory).toHaveBeenCalledTimes(1);
    expect(out[0]?.quote?.bidPrice).toBe(100);
    await session.close();
  });

  it("returns cached value within cacheTtlMs without waiting", async () => {
    const { session, sockets } = makeHarness({ cacheTtlMs: 5_000 });
    const p1 = session.snapshot(["AAPL"]);
    await flush();
    const ws = sockets[0]!;
    ws.driveHandshake();
    await flush();
    ws.emitQuote("AAPL", 100, 101);
    await p1;

    // No further events emitted; cache should serve the 2nd call.
    const start = Date.now();
    const out = await session.snapshot(["AAPL"]);
    expect(Date.now() - start).toBeLessThan(50);
    expect(out[0]?.quote?.bidPrice).toBe(100);
    await session.close();
  });

  it("sends incremental FEED_SUBSCRIPTION add for a new symbol on an existing channel", async () => {
    const { session, sockets } = makeHarness();
    const p1 = session.snapshot(["AAPL"]);
    await flush();
    const ws = sockets[0]!;
    ws.driveHandshake();
    await flush();
    ws.emitQuote("AAPL", 100, 101);
    await p1;
    ws.sent.length = 0; // clear log

    const p2 = session.snapshot(["TSLA"]);
    await flush();
    ws.emitQuote("TSLA", 200, 201);
    await p2;

    const subs = ws
      .parsed()
      .filter((m) => m.type === "FEED_SUBSCRIPTION") as { add?: unknown[]; reset?: boolean }[];
    expect(subs.length).toBeGreaterThan(0);
    // No reset: it's an incremental add.
    expect(subs.every((s) => s.reset !== true)).toBe(true);
    await session.close();
  });

  it("does not churn add/remove for back-to-back snapshots within linger window", async () => {
    const { session, sockets } = makeHarness({ lingerMs: 1_000 });
    const p1 = session.snapshot(["AAPL"]);
    await flush();
    const ws = sockets[0]!;
    ws.driveHandshake();
    await flush();
    ws.emitQuote("AAPL", 100, 101);
    await p1;

    const beforeCount = ws.sent.length;
    const p2 = session.snapshot(["AAPL"]);
    // Same cached value serves; no new send needed.
    await p2;
    expect(ws.sent.length).toBe(beforeCount);
    await session.close();
  });

  it("rejects snapshot calls after close()", async () => {
    const { session } = makeHarness();
    await session.close();
    await expect(session.snapshot(["AAPL"])).rejects.toThrow(/closed/);
  });

  it("emits a remove only after linger expires once refcount hits 0", async () => {
    const { session, sockets } = makeHarness({ lingerMs: 100, cacheTtlMs: 10 });
    const p1 = session.snapshot(["AAPL"]);
    await flush();
    const ws = sockets[0]!;
    ws.driveHandshake();
    await flush();
    ws.emitQuote("AAPL", 100, 101);
    await p1;

    // Linger pending — no remove yet.
    expect(ws.parsed().filter((m) => Array.isArray(m.remove)).length).toBe(0);
    await vi.advanceTimersByTimeAsync(150);
    const removes = ws
      .parsed()
      .filter((m) => m.type === "FEED_SUBSCRIPTION" && Array.isArray(m.remove));
    expect(removes.length).toBe(1);
    await session.close();
  });

  it("rejects after maxUnauthorizedAttempts and invalidates OAuth on each rejection", async () => {
    const { session, sockets, invalidateOAuthCalls, getTokenCalls } = makeHarness({
      maxUnauthorizedAttempts: 2,
      unauthorizedBackoffMs: 5,
    });
    const promise = session.snapshot(["AAPL"]);

    // First connect → UNAUTHORIZED
    await flush();
    sockets[0]!.driveUnauthorized();
    // Allow backoff timer + reconnect
    await vi.advanceTimersByTimeAsync(20);
    await flush();
    // Second connect → UNAUTHORIZED again → exceeds cap → rejects
    sockets[1]!.driveUnauthorized();
    await flush();

    await expect(promise).rejects.toThrow(/rejected authentication/);
    expect(invalidateOAuthCalls.count).toBe(2);
    expect(getTokenCalls.count).toBe(2);
    await session.close();
  });

  it("resets reconnect/auth counters on a fresh snapshot call after a wedged cycle", async () => {
    const { session, sockets, invalidateOAuthCalls } = makeHarness({
      maxUnauthorizedAttempts: 1,
      unauthorizedBackoffMs: 5,
    });

    // Cycle 1 — wedge it with one UNAUTHORIZED (cap=1).
    const failed = session.snapshot(["AAPL"]);
    await flush();
    sockets[0]!.driveUnauthorized();
    await flush();
    await expect(failed).rejects.toThrow(/rejected authentication/);
    expect(invalidateOAuthCalls.count).toBe(1);

    // Cycle 2 — same session, fresh attempt. Counters should be reset so it
    // tries again from scratch and succeeds this time.
    const second = session.snapshot(["AAPL"]);
    await flush();
    expect(sockets.length).toBe(2);
    sockets[1]!.driveHandshake();
    await flush();
    sockets[1]!.emitQuote("AAPL", 100, 101);
    const result = await second;
    expect(result[0]?.quote?.bidPrice).toBe(100);
    await session.close();
  });
});
