// Long-lived DXLink session: one shared WebSocket across snapshot calls.
// Refcounts subscriptions, caches last-known values, lingers on unsubscribe,
// reconnects on transport failure, and idles closed after a quiet period.

import WebSocket from "ws";

import { BUILD_INFO } from "../build-info.js";
import { getApiQuoteToken } from "../client/endpoints/quote-tokens.js";
import type { Logger, TastytradeHttpClient } from "../client/http.js";
import {
  type EventType,
  type GreeksFields,
  type MarketSnapshot,
  type QuoteFields,
  REQUESTED_FIELDS,
  defaultTypesForSymbol,
} from "./dxlink-types.js";
import { toDxlink } from "./symbol.js";

const CHANNEL = 3;
const KEEPALIVE_INTERVAL_MS = 30_000;
const MIN_VALID_EPOCH_MS = 978307200000; // 2001-01-01

export type WSLike = {
  on(event: "open", cb: () => void): unknown;
  on(event: "message", cb: (data: unknown) => void): unknown;
  on(event: "error", cb: (err: unknown) => void): unknown;
  on(event: "close", cb: () => void): unknown;
  send(data: string): void;
  close(code?: number): void;
};

export type WSFactory = (url: string) => WSLike;

export type DxlinkSessionOptions = {
  idleTimeoutMs?: number;
  cacheTtlMs?: number;
  lingerMs?: number;
  defaultTimeoutMs?: number;
  maxReconnectAttempts?: number;
  // Force a fresh OAuth grant on UNAUTHORIZED — the cached access token may
  // have been revoked or rescoped server-side. Wired from createServer.
  invalidateOAuth?: () => void;
  // SETUP.version field sent to DXLink. Configurable so users can mimic the
  // official SDK (e.g. "0.1-DXF-JS/0.3.0") to probe for client fingerprinting.
  dxlinkVersion?: string;
  logger?: Logger;
  wsFactory?: WSFactory;
  getToken?: () => Promise<{ token: string; dxlinkUrl: string }>;
  now?: () => number;
};

type ConnState = "idle" | "connecting" | "ready" | "reconnecting" | "closed";

export type SessionDiagnostics = {
  state: ConnState;
  subscribedSymbols: string[];
  onWire: number;
  pendingRemoves: number;
  refcountTotal: number;
  cachedSymbols: number;
  reconnectAttempts: number;
  lastConnectedAt: string | null;
  lastError: string | null;
  // What TT routed us to (host without query) — surfaces env-mismatch /
  // cluster-routing issues without leaking the token.
  lastDxlinkUrl: string | null;
  // The most recent non-AUTHORIZED AUTH_STATE body received from DXLink.
  // TT sometimes includes a reason / error field here; surfacing it is the
  // fastest way to discriminate scope vs grant vs cluster vs token issues.
  lastAuthState: Record<string, unknown> | null;
};

type CacheEntry = {
  quote?: QuoteFields;
  greeks?: GreeksFields;
  quoteAt?: number;
  greeksAt?: number;
};

type Outgoing = Record<string, unknown> & { type: string; channel?: number };

const subKey = (sym: string, t: EventType): string => `${sym}|${t}`;

export class DxlinkSession {
  readonly mode = "dxlink" as const;
  private state: ConnState = "idle";
  private ws: WSLike | null = null;
  private token: string | null = null;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((err: Error) => void) | null = null;

  private readonly cache = new Map<string, CacheEntry>();
  private readonly refcounts = new Map<string, number>();
  private readonly onWire = new Set<string>();
  private readonly pendingRemoves = new Map<string, NodeJS.Timeout>();
  private readonly waiters = new Map<string, (() => void)[]>();
  private readonly agreedFields: Partial<Record<EventType, string[]>> = {};

  private idleTimer: NodeJS.Timeout | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private lastConnectedAt: number | null = null;
  private lastError: string | null = null;
  private lastDxlinkUrl: string | null = null;
  private lastAuthState: Record<string, unknown> | null = null;
  // DXLink sends an initial AUTH_STATE:UNAUTHORIZED *before* we've sent AUTH —
  // it's the pre-auth state of the channel, not an error. The official SDK
  // tracks this with an isFirstAuthState flag; we mirror that. Reset on every
  // (re)connect so each fresh session has its own pre-auth signal.
  private isFirstAuthState = true;
  // When true, the next ws-close handler should not schedule a reconnect
  // (caller is permanently giving up for this attempt cycle).
  private gaveUpThisCycle = false;

  private readonly idleTimeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly lingerMs: number;
  private readonly defaultTimeoutMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly invalidateOAuth: () => void;
  private readonly dxlinkVersion: string;
  private readonly wsFactory: WSFactory;
  private readonly getToken: () => Promise<{ token: string; dxlinkUrl: string }>;
  private readonly now: () => number;
  private readonly logger: Logger;

  constructor(http: TastytradeHttpClient, opts: DxlinkSessionOptions = {}) {
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 30_000;
    this.cacheTtlMs = opts.cacheTtlMs ?? 1_000;
    this.lingerMs = opts.lingerMs ?? 500;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 5_000;
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? 10;
    this.invalidateOAuth = opts.invalidateOAuth ?? (() => undefined);
    this.dxlinkVersion = opts.dxlinkVersion ?? `0.1-mcp-tastytrade-js/${BUILD_INFO.version}`;
    this.wsFactory = opts.wsFactory ?? ((url) => new WebSocket(url) as unknown as WSLike);
    this.getToken = opts.getToken ?? (() => getApiQuoteToken(http));
    this.now = opts.now ?? (() => Date.now());
    this.logger = opts.logger ?? {};
  }

  async snapshot(
    symbols: string[],
    types?: EventType[],
    timeoutMs?: number,
  ): Promise<MarketSnapshot[]> {
    if (this.state === "closed") throw new Error("DxlinkSession is closed");
    if (symbols.length === 0) return [];

    const dxlinkMap = new Map<string, string>();
    const dxSymbols: string[] = [];
    const typesPerSym = new Map<string, EventType[]>();
    for (const s of symbols) {
      const dx = toDxlink(s);
      dxlinkMap.set(dx, s);
      dxSymbols.push(dx);
      typesPerSym.set(dx, types ?? defaultTypesForSymbol(dx));
    }

    for (const dx of dxSymbols) {
      for (const t of typesPerSym.get(dx)!) this.acquire(dx, t);
    }

    try {
      await this.ensureReady();
      const deadline = this.now() + (timeoutMs ?? this.defaultTimeoutMs);
      await Promise.all(
        dxSymbols.flatMap((dx) =>
          typesPerSym.get(dx)!.map((t) => this.waitForFresh(dx, t, deadline)),
        ),
      );
    } finally {
      for (const dx of dxSymbols) {
        for (const t of typesPerSym.get(dx)!) this.release(dx, t);
      }
    }

    return dxSymbols.map((dx): MarketSnapshot => {
      const entry = this.cache.get(dx);
      return {
        symbol: dxlinkMap.get(dx)!,
        dxlinkSymbol: dx,
        receivedAt: this.now(),
        quote: entry?.quote ?? null,
        greeks: entry?.greeks ?? null,
      };
    });
  }

  getDiagnostics(): SessionDiagnostics {
    let refcountTotal = 0;
    for (const n of this.refcounts.values()) refcountTotal += n;
    return {
      state: this.state,
      subscribedSymbols: [
        ...new Set(Array.from(this.refcounts.keys()).map((k) => k.split("|")[0]!)),
      ],
      onWire: this.onWire.size,
      pendingRemoves: this.pendingRemoves.size,
      refcountTotal,
      cachedSymbols: this.cache.size,
      reconnectAttempts: this.reconnectAttempts,
      lastConnectedAt:
        this.lastConnectedAt !== null ? new Date(this.lastConnectedAt).toISOString() : null,
      lastError: this.lastError,
      lastDxlinkUrl: this.lastDxlinkUrl,
      lastAuthState: this.lastAuthState,
    };
  }

  async close(): Promise<void> {
    this.state = "closed";
    this.clearIdleTimer();
    this.clearKeepalive();
    for (const t of this.pendingRemoves.values()) clearTimeout(t);
    this.pendingRemoves.clear();
    this.refcounts.clear();
    this.onWire.clear();
    for (const list of this.waiters.values()) for (const w of list) w();
    this.waiters.clear();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* socket may already be closed */
      }
      this.ws = null;
    }
  }

  // ---------------- subscription refcounting ----------------

  private acquire(dx: string, t: EventType): void {
    this.clearIdleTimer();
    const k = subKey(dx, t);
    const pending = this.pendingRemoves.get(k);
    if (pending) {
      clearTimeout(pending);
      this.pendingRemoves.delete(k);
    }
    const cur = this.refcounts.get(k) ?? 0;
    this.refcounts.set(k, cur + 1);
    if (cur === 0 && this.state === "ready" && !this.onWire.has(k)) {
      this.sendAdd(dx, t);
    }
  }

  private release(dx: string, t: EventType): void {
    const k = subKey(dx, t);
    const cur = this.refcounts.get(k) ?? 0;
    if (cur > 1) {
      this.refcounts.set(k, cur - 1);
      return;
    }
    this.refcounts.delete(k);
    const timer = setTimeout(() => {
      this.pendingRemoves.delete(k);
      if ((this.refcounts.get(k) ?? 0) === 0 && this.onWire.has(k)) {
        this.sendRemove(dx, t);
      }
      this.maybeStartIdleTimer();
    }, this.lingerMs);
    this.pendingRemoves.set(k, timer);
  }

  private maybeStartIdleTimer(): void {
    if (this.idleTimer) return;
    if (this.state !== "ready") return;
    if (this.refcounts.size > 0 || this.pendingRemoves.size > 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.shutdownConnection("idle");
    }, this.idleTimeoutMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // ---------------- connection lifecycle ----------------

  private async ensureReady(): Promise<void> {
    if (this.state === "ready") return;
    if (this.state === "closed") throw new Error("DxlinkSession is closed");
    if (this.readyPromise) return this.readyPromise;
    // A fresh request begins a fresh attempt cycle. Reset the reconnect
    // counter so a previous wedged cycle doesn't permanently disable the session.
    this.reconnectAttempts = 0;
    this.gaveUpThisCycle = false;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.connect().catch(() => {
      /* connect() handles its own failures via scheduleReconnect/failReady */
    });
    return this.readyPromise;
  }

  private async connect(): Promise<void> {
    if (this.state === "closed") return;
    this.state = "connecting";
    this.isFirstAuthState = true;
    try {
      this.logger.debug?.("dxlink: fetching api-quote-token");
      const tok = await this.getToken();
      if ((this.state as ConnState) === "closed") return;
      this.token = tok.token;
      // Record sanitized url (origin only) so diagnostics surface cluster-routing
      // without exposing query-string tokens TT may attach to the URL.
      this.lastDxlinkUrl = sanitizeUrl(tok.dxlinkUrl);
      this.logger.debug?.(
        `dxlink: got api-quote-token (length=${tok.token.length}, url=${this.lastDxlinkUrl}); opening WS`,
      );
      const ws = this.wsFactory(tok.dxlinkUrl);
      this.ws = ws;
      ws.on("open", () => this.handleOpen());
      ws.on("message", (raw: unknown) => this.handleRawMessage(raw));
      ws.on("error", (err: unknown) => this.logger.warn?.("dxlink: ws error", err));
      ws.on("close", () => this.handleClose());
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.logger.warn?.("dxlink: token/connect failed", err);
      this.scheduleReconnect();
    }
  }

  private handleOpen(): void {
    // Match the official @dxfeed/dxlink-websocket-client wire format exactly:
    //   - `version` = "<protocolVersion>-<clientName>/<clientVersion>"
    //   - send SETUP and AUTH back-to-back without waiting for the server's
    //     SETUP echo (the server may not echo it, and gating AUTH on an echo
    //     leaves a race that TT has begun rejecting as UNAUTHORIZED).
    this.send({
      type: "SETUP",
      channel: 0,
      version: this.dxlinkVersion,
      keepaliveTimeout: 60,
      acceptKeepaliveTimeout: 60,
    });
    if (this.token) {
      this.send({ type: "AUTH", channel: 0, token: this.token });
    }
  }

  private handleRawMessage(raw: unknown): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      return;
    }
    this.handleMessage(msg);
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string | undefined;
    switch (type) {
      case "SETUP":
        // Server-side echo. We already sent AUTH on transport-open;
        // no further action needed here.
        break;
      case "ERROR": {
        // Top-level errors carry the reason we've been missing — e.g.
        // { error: "UNAUTHORIZED", message: "Token expired" }. Capture
        // the full body for diagnostics so the agent can see the cause.
        const body = JSON.stringify(msg);
        this.lastError = `DXLink ERROR ${body}`;
        this.lastAuthState = msg;
        this.logger.warn?.("dxlink: ERROR body:", body);
        break;
      }
      case "AUTH_STATE": {
        // DXLink sends an *initial* AUTH_STATE message right after SETUP to
        // report the pre-auth state of the channel — almost always UNAUTHORIZED,
        // because we haven't sent AUTH yet. This is normal and per protocol
        // (confirmed by TT support and the @dxfeed/dxlink-api SDK, which
        // tracks an `isFirstAuthState` flag for exactly this reason). Treat
        // the very first AUTH_STATE as informational and don't react.
        if (this.isFirstAuthState) {
          this.isFirstAuthState = false;
          this.logger.debug?.(
            `dxlink: initial AUTH_STATE=${String(msg.state)} (pre-auth, ignored)`,
          );
          break;
        }
        if (msg.state === "AUTHORIZED") {
          this.lastAuthState = null;
          this.startKeepalive();
          this.send({
            type: "CHANNEL_REQUEST",
            channel: CHANNEL,
            service: "FEED",
            parameters: { contract: "AUTO" },
          });
        } else if (msg.state === "UNAUTHORIZED") {
          // Post-AUTH UNAUTHORIZED — this is a real rejection. Fail fast;
          // the next user-initiated snapshot() starts a fresh cycle, and
          // invalidating OAuth ensures it picks up a fresh access token.
          this.lastAuthState = msg;
          this.lastError = `DXLink UNAUTHORIZED ${JSON.stringify(msg)}`;
          this.logger.warn?.("dxlink: AUTH_STATE body:", JSON.stringify(msg));
          this.token = null;
          try {
            this.invalidateOAuth();
          } catch {
            /* never throw from message handler */
          }
          const err = new Error(
            "DXLink rejected authentication. Check the OAuth scope on your grant, whether the refresh token is still valid, or whether another client holds the DXLink session for this grant. Run get_diagnostics for the full AUTH_STATE body.",
          );
          this.logger.error?.("dxlink: giving up auth:", err.message);
          this.gaveUpThisCycle = true;
          this.failReady(err);
          this.wakeAllWaiters();
          this.ws?.close();
        }
        break;
      }
      case "CHANNEL_OPENED": {
        const acceptEventFields: Record<string, string[]> = {};
        for (const t of Object.keys(REQUESTED_FIELDS) as EventType[]) {
          acceptEventFields[t] = REQUESTED_FIELDS[t];
        }
        this.send({
          type: "FEED_SETUP",
          channel: CHANNEL,
          acceptAggregationPeriod: 0.1,
          acceptDataFormat: "COMPACT",
          acceptEventFields,
        });
        break;
      }
      case "FEED_CONFIG": {
        const evFields = msg.eventFields as Partial<Record<EventType, string[]>> | undefined;
        if (evFields) {
          for (const [t, fields] of Object.entries(evFields)) {
            if (fields) this.agreedFields[t as EventType] = fields;
          }
        }
        if (this.state !== "ready") {
          this.state = "ready";
          this.reconnectAttempts = 0;
          this.lastConnectedAt = this.now();
          this.lastError = null;
          this.replaySubscriptions();
          this.resolveReadyPromise();
        }
        break;
      }
      case "FEED_DATA":
        this.handleFeedData(msg.data);
        break;
      case "KEEPALIVE":
        this.send({ type: "KEEPALIVE", channel: 0 });
        break;
      default:
        this.logger.debug?.("dxlink: unhandled message", JSON.stringify(msg));
        break;
    }
  }

  private replaySubscriptions(): void {
    const add: { type: EventType; symbol: string }[] = [];
    for (const k of this.refcounts.keys()) {
      const [sym, t] = k.split("|") as [string, EventType];
      add.push({ type: t, symbol: sym });
      this.onWire.add(k);
    }
    if (add.length > 0) {
      this.send({ type: "FEED_SUBSCRIPTION", channel: CHANNEL, reset: true, add });
    }
  }

  private resolveReadyPromise(): void {
    const resolve = this.resolveReady;
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
    resolve?.();
  }

  private handleClose(): void {
    this.ws = null;
    this.clearKeepalive();
    this.onWire.clear();
    for (const k of Object.keys(this.agreedFields) as EventType[]) delete this.agreedFields[k];
    if (this.state === "closed") return;
    const hasWork = this.refcounts.size > 0 || this.waiters.size > 0;
    this.state = "idle";
    if (this.gaveUpThisCycle) {
      // The auth handler has already failed the ready promise and woken waiters.
      // Don't reconnect — leave state as idle so the next snapshot() can start fresh.
      return;
    }
    if (hasWork) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.state === "closed") return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      const err = new Error(`DXLink reconnect exhausted (${this.maxReconnectAttempts} attempts)`);
      this.logger.error?.("dxlink: giving up", err.message);
      this.failReady(err);
      this.wakeAllWaiters();
      return;
    }
    // Exponential backoff for transport-level reconnects (network blips,
    // transient ws closes). Auth failures don't come through here — they
    // fail-fast in the AUTH_STATE handler without scheduling a reconnect.
    const delay = Math.min(250 * 2 ** this.reconnectAttempts, 5000);
    this.reconnectAttempts += 1;
    this.state = "reconnecting";
    setTimeout(() => {
      if (this.state === "closed") return;
      void this.connect();
    }, delay);
  }

  private failReady(err: Error): void {
    this.lastError = err.message;
    const reject = this.rejectReady;
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
    reject?.(err);
  }

  private wakeAllWaiters(): void {
    for (const list of this.waiters.values()) for (const w of list) w();
    this.waiters.clear();
  }

  private shutdownConnection(reason: "idle" | "close"): void {
    if (this.state !== "ready") return;
    this.logger.debug?.(`dxlink: closing connection (${reason})`);
    try {
      this.send({ type: "CHANNEL_CANCEL", channel: CHANNEL });
    } catch {
      /* socket may already be closing */
    }
    this.clearKeepalive();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state = "idle";
    this.onWire.clear();
    for (const k of Object.keys(this.agreedFields) as EventType[]) delete this.agreedFields[k];
  }

  // ---------------- subscription messages ----------------

  private sendAdd(dx: string, t: EventType): void {
    this.send({
      type: "FEED_SUBSCRIPTION",
      channel: CHANNEL,
      add: [{ type: t, symbol: dx }],
    });
    this.onWire.add(subKey(dx, t));
  }

  private sendRemove(dx: string, t: EventType): void {
    this.send({
      type: "FEED_SUBSCRIPTION",
      channel: CHANNEL,
      remove: [{ type: t, symbol: dx }],
    });
    this.onWire.delete(subKey(dx, t));
  }

  private send(msg: Outgoing): void {
    if (!this.ws) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err) {
      this.logger.warn?.("dxlink: send failed", err);
    }
  }

  // ---------------- keepalive ----------------

  private startKeepalive(): void {
    this.clearKeepalive();
    this.keepaliveTimer = setInterval(() => {
      this.send({ type: "KEEPALIVE", channel: 0 });
    }, KEEPALIVE_INTERVAL_MS);
  }

  private clearKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  // ---------------- record extraction ----------------

  private handleFeedData(data: unknown): void {
    if (!Array.isArray(data) || data.length < 2) return;
    for (let i = 0; i + 1 < data.length; i += 2) {
      const eventType = data[i] as EventType;
      const payload = data[i + 1];
      if (!Array.isArray(payload)) continue;
      const fields = this.agreedFields[eventType] ?? REQUESTED_FIELDS[eventType];
      if (!fields) continue;
      const symbolIdx = fields.indexOf("eventSymbol");
      if (symbolIdx === -1) continue;
      for (let j = 0; j + fields.length <= payload.length; j += fields.length) {
        const sym = payload[j + symbolIdx];
        if (typeof sym !== "string") continue;
        const record = extractRecord(eventType, payload, j, fields);
        this.applyRecord(sym, eventType, record);
      }
    }
  }

  private applyRecord(sym: string, t: EventType, rec: QuoteFields | GreeksFields): void {
    let entry = this.cache.get(sym);
    if (!entry) {
      entry = {};
      this.cache.set(sym, entry);
    }
    const at = this.now();
    if (t === "Quote") {
      entry.quote = rec as QuoteFields;
      entry.quoteAt = at;
    } else {
      entry.greeks = rec as GreeksFields;
      entry.greeksAt = at;
    }
    const k = subKey(sym, t);
    const list = this.waiters.get(k);
    if (list && list.length > 0) {
      this.waiters.delete(k);
      for (const w of list) w();
    }
  }

  private waitForFresh(dx: string, t: EventType, deadline: number): Promise<void> {
    const entry = this.cache.get(dx);
    const at = t === "Quote" ? entry?.quoteAt : entry?.greeksAt;
    if (at !== undefined && this.now() - at < this.cacheTtlMs) return Promise.resolve();

    const remaining = deadline - this.now();
    if (remaining <= 0) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const k = subKey(dx, t);
      let timer: NodeJS.Timeout | null = null;
      const fire = (): void => {
        if (timer) clearTimeout(timer);
        timer = null;
        resolve();
      };
      const list = this.waiters.get(k) ?? [];
      list.push(fire);
      this.waiters.set(k, list);
      timer = setTimeout(() => {
        const cur = this.waiters.get(k);
        if (cur) {
          const idx = cur.indexOf(fire);
          if (idx !== -1) cur.splice(idx, 1);
          if (cur.length === 0) this.waiters.delete(k);
        }
        resolve();
      }, remaining);
    });
  }
}

const numOrNull = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    if (v === "NaN" || v === "" || v === "Infinity" || v === "-Infinity") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const epochMsToIso = (ms: number | null): string | null => {
  if (ms === null || !Number.isFinite(ms) || ms < MIN_VALID_EPOCH_MS) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
};

const extractRecord = (
  eventType: EventType,
  payload: unknown[],
  base: number,
  fields: string[],
): QuoteFields | GreeksFields => {
  const at = (name: string): number | null => {
    const idx = fields.indexOf(name);
    return idx === -1 ? null : numOrNull(payload[base + idx]);
  };
  if (eventType === "Quote") {
    const eventTime = at("time");
    return {
      bidPrice: at("bidPrice"),
      askPrice: at("askPrice"),
      bidSize: at("bidSize"),
      askSize: at("askSize"),
      eventTime,
      eventTimeIso: epochMsToIso(eventTime),
    };
  }
  return {
    price: at("price"),
    volatility: at("volatility"),
    delta: at("delta"),
    gamma: at("gamma"),
    theta: at("theta"),
    rho: at("rho"),
    vega: at("vega"),
  };
};

// Drop the query string (which on some routes carries auth material) and return
// just the protocol + host + path. Always returns a string, even on malformed input.
const sanitizeUrl = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url.split("?")[0] ?? url;
  }
};
