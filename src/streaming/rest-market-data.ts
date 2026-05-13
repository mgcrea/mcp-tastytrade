// REST-based MarketDataProvider — calls /market-data/by-type instead of DXLink.
// Greeks are unavailable via REST; `MarketSnapshot.greeks` is always null.

import {
  getMarketDataByType,
  type MarketDataByTypeRequest,
  type MarketDataRow,
} from "../client/endpoints/market-data.js";
import type { Logger, TastytradeHttpClient } from "../client/http.js";
import type { EventType, MarketSnapshot, QuoteFields } from "./dxlink-types.js";
import type { MarketDataProvider } from "./market-data-provider.js";
import { isDxlinkOption, isOccOption, occToDxlink, toOcc } from "./symbol.js";

export type RestMarketDataOptions = {
  logger?: Logger;
  defaultTimeoutMs?: number;
  // Crypto symbols on Tastytrade contain a slash (BTC/USD). Used to classify symbols.
  isCryptocurrency?: (sym: string) => boolean;
};

const defaultIsCrypto = (sym: string): boolean => sym.includes("/");

type Classified = {
  // The symbol we send to REST (OCC format for options, raw for everything else).
  restSymbol: string;
  bucket: keyof MarketDataByTypeRequest;
};

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    if (v === "" || v === "NaN" || v === "Infinity" || v === "-Infinity") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const rowToQuote = (row: MarketDataRow): QuoteFields => {
  const updatedAt = typeof row.updatedAt === "string" ? row.updatedAt : null;
  const eventTime = updatedAt ? new Date(updatedAt).getTime() : null;
  return {
    bidPrice: numOrNull(row.bid),
    askPrice: numOrNull(row.ask),
    bidSize: numOrNull(row.bidSize),
    askSize: numOrNull(row.askSize),
    eventTime: eventTime !== null && Number.isFinite(eventTime) ? eventTime : null,
    eventTimeIso: updatedAt,
  };
};

export class RestMarketDataProvider implements MarketDataProvider {
  readonly mode = "rest" as const;

  private readonly http: TastytradeHttpClient;
  private readonly logger: Logger;
  private readonly defaultTimeoutMs: number;
  private readonly isCryptocurrency: (sym: string) => boolean;

  private lastRequestAt: number | null = null;
  private lastRequestCount = 0;
  private lastErrorMessage: string | null = null;
  private totalRequests = 0;

  constructor(http: TastytradeHttpClient, opts: RestMarketDataOptions = {}) {
    this.http = http;
    this.logger = opts.logger ?? {};
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 5_000;
    this.isCryptocurrency = opts.isCryptocurrency ?? defaultIsCrypto;
  }

  async snapshot(
    symbols: string[],
    _types?: EventType[],
    timeoutMs?: number,
  ): Promise<MarketSnapshot[]> {
    if (symbols.length === 0) return [];

    const classifications = symbols.map((s) => this.classify(s));

    const buckets: MarketDataByTypeRequest = {};
    const pushTo = (key: keyof MarketDataByTypeRequest, sym: string): void => {
      const list = (buckets[key] ?? []) as string[];
      list.push(sym);
      buckets[key] = list;
    };
    for (const c of classifications) pushTo(c.bucket, c.restSymbol);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.defaultTimeoutMs);
    let rows: MarketDataRow[] = [];
    try {
      this.totalRequests += 1;
      this.lastRequestAt = Date.now();
      this.lastRequestCount = symbols.length;
      rows = await getMarketDataByType(this.http, buckets, { signal: controller.signal });
      this.lastErrorMessage = null;
    } catch (err) {
      this.lastErrorMessage = err instanceof Error ? err.message : String(err);
      this.logger.warn?.("rest-market-data: request failed", err);
      throw err;
    } finally {
      clearTimeout(timer);
    }

    // The /market-data/by-type response echoes option symbols in OCC format,
    // so build a lookup map keyed by the REST symbol (what we sent).
    const byRestSymbol = new Map<string, MarketDataRow>();
    for (const row of rows) byRestSymbol.set(row.symbol, row);

    return symbols.map((requestedSymbol, idx): MarketSnapshot => {
      const c = classifications[idx]!;
      const row = byRestSymbol.get(c.restSymbol);
      // dxlinkSymbol mirrors what DxlinkSession exposes: the streamer-format
      // identifier. For options, derive it from OCC; otherwise the raw symbol.
      const dxlinkSymbol = isOccOption(c.restSymbol) ? occToDxlink(c.restSymbol) : requestedSymbol;
      return {
        symbol: requestedSymbol,
        dxlinkSymbol,
        receivedAt: Date.now(),
        quote: row ? rowToQuote(row) : null,
        greeks: null,
      };
    });
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      mode: this.mode,
      totalRequests: this.totalRequests,
      lastRequestAt:
        this.lastRequestAt !== null ? new Date(this.lastRequestAt).toISOString() : null,
      lastRequestCount: this.lastRequestCount,
      lastError: this.lastErrorMessage,
    };
  }

  private classify(sym: string): Classified {
    // Options: convert any DXLink-format option to OCC for the REST endpoint.
    if (isDxlinkOption(sym) || isOccOption(sym)) {
      return { restSymbol: toOcc(sym), bucket: "equityOptions" };
    }
    if (this.isCryptocurrency(sym)) {
      return { restSymbol: sym, bucket: "cryptocurrencies" };
    }
    // Everything else is treated as an equity. Indices/futures could in
    // principle be routed to their own buckets, but the MCP doesn't currently
    // distinguish them at this layer — equities is the safe default.
    return { restSymbol: sym, bucket: "equities" };
  }
}
