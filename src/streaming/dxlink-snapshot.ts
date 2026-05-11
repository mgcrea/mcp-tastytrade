import WebSocket from "ws";

import { getApiQuoteToken } from "../client/endpoints/quote-tokens.js";
import type { TastytradeHttpClient } from "../client/http.js";
import { isOption, toDxlink } from "./symbol.js";

export type EventType = "Quote" | "Greeks";

export type QuoteFields = {
  bidPrice: number | null;
  askPrice: number | null;
  bidSize: number | null;
  askSize: number | null;
  eventTime: number | null;
  eventTimeIso: string | null;
};

export type GreeksFields = {
  price: number | null;
  volatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  rho: number | null;
  vega: number | null;
};

export type MarketSnapshot = {
  symbol: string;
  dxlinkSymbol: string;
  receivedAt: number;
  quote: QuoteFields | null;
  greeks: GreeksFields | null;
};

type Outgoing = Record<string, unknown> & { type: string; channel?: number };

const CHANNEL = 3;

const REQUESTED_FIELDS: Record<EventType, string[]> = {
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
};

export const defaultTypesForSymbol = (sym: string): EventType[] =>
  isOption(sym) ? ["Quote", "Greeks"] : ["Quote"];

type Buffer = Map<string, Partial<MarketSnapshot> & { types: Set<EventType> }>;

export type SnapshotOptions = {
  types?: EventType[];
  timeoutMs?: number;
};

export const getMarketSnapshot = async (
  http: TastytradeHttpClient,
  symbol: string,
  opts: SnapshotOptions = {},
): Promise<MarketSnapshot> => {
  const [result] = await getMarketSnapshots(http, [symbol], opts);
  if (!result) throw new Error(`No snapshot returned for ${symbol}`);
  return result;
};

export const getMarketSnapshots = async (
  http: TastytradeHttpClient,
  symbols: string[],
  opts: SnapshotOptions = {},
): Promise<MarketSnapshot[]> => {
  if (symbols.length === 0) return [];
  const timeoutMs = opts.timeoutMs ?? 5000;

  // Normalize: OCC → DXLink, preserve original-keyed mapping
  const symbolMap = new Map<string, string>(); // dxlinkSymbol → original
  const dxlinkSymbols: string[] = [];
  const typesPerSymbol = new Map<string, EventType[]>();
  for (const s of symbols) {
    const dx = toDxlink(s);
    symbolMap.set(dx, s);
    dxlinkSymbols.push(dx);
    typesPerSymbol.set(dx, opts.types ?? defaultTypesForSymbol(dx));
  }
  // Union of all requested event types — what we'll ask the feed for
  const allTypes = new Set<EventType>();
  for (const ts of typesPerSymbol.values()) for (const t of ts) allTypes.add(t);

  const { token, dxlinkUrl } = await getApiQuoteToken(http);
  const ws = new WebSocket(dxlinkUrl);
  const send = (msg: Outgoing): void => {
    ws.send(JSON.stringify(msg));
  };

  const buffer: Buffer = new Map();
  const agreedFields: Partial<Record<EventType, string[]>> = {};
  let subscribed = false;

  const isComplete = (): boolean => {
    for (const dx of dxlinkSymbols) {
      const want = typesPerSymbol.get(dx)!;
      const got = buffer.get(dx)?.types ?? new Set<EventType>();
      for (const t of want) if (!got.has(t)) return false;
    }
    return true;
  };

  const buildResult = (): MarketSnapshot[] =>
    dxlinkSymbols.map((dx): MarketSnapshot => {
      const b = buffer.get(dx);
      const original = symbolMap.get(dx)!;
      return {
        symbol: original,
        dxlinkSymbol: dx,
        receivedAt: Date.now(),
        quote: (b?.quote as QuoteFields | undefined) ?? null,
        greeks: (b?.greeks as GreeksFields | undefined) ?? null,
      };
    });

  return new Promise<MarketSnapshot[]>((resolve, reject) => {
    const cleanup = (): void => {
      try {
        send({ type: "CHANNEL_CANCEL", channel: CHANNEL });
      } catch {
        /* socket may already be closed */
      }
      ws.close();
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      // On timeout: return whatever we collected (partial > error for snapshots)
      cleanup();
      resolve(buildResult());
    }, timeoutMs);

    ws.on("error", (err) => {
      clearTimeout(timer);
      ws.close();
      reject(err);
    });

    ws.on("open", () => {
      send({
        type: "SETUP",
        channel: 0,
        version: "0.1-mcp-tastytrade",
        keepaliveTimeout: 60,
        acceptKeepaliveTimeout: 60,
      });
    });

    ws.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = msg.type as string | undefined;
      switch (type) {
        case "SETUP":
          send({ type: "AUTH", channel: 0, token });
          break;
        case "AUTH_STATE":
          if (msg.state === "AUTHORIZED") {
            send({
              type: "CHANNEL_REQUEST",
              channel: CHANNEL,
              service: "FEED",
              parameters: { contract: "AUTO" },
            });
          }
          break;
        case "CHANNEL_OPENED": {
          const acceptEventFields: Record<string, string[]> = {};
          for (const t of allTypes) acceptEventFields[t] = REQUESTED_FIELDS[t];
          send({
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
              if (fields) agreedFields[t as EventType] = fields;
            }
          }
          if (!subscribed) {
            subscribed = true;
            const add: { type: EventType; symbol: string }[] = [];
            for (const dx of dxlinkSymbols) {
              for (const t of typesPerSymbol.get(dx)!) add.push({ type: t, symbol: dx });
            }
            send({ type: "FEED_SUBSCRIPTION", channel: CHANNEL, reset: true, add });
          }
          break;
        }
        case "FEED_DATA": {
          handleFeedData(msg.data, agreedFields, buffer, symbolMap);
          if (isComplete()) {
            cleanup();
            resolve(buildResult());
          }
          break;
        }
        default:
          break;
      }
    });
  });
};

const handleFeedData = (
  data: unknown,
  agreedFields: Partial<Record<EventType, string[]>>,
  buffer: Buffer,
  symbolMap: Map<string, string>,
): void => {
  if (!Array.isArray(data) || data.length < 2) return;
  // COMPACT format: [eventTypeA, [...recordsA], eventTypeB, [...recordsB], ...]
  for (let i = 0; i + 1 < data.length; i += 2) {
    const eventType = data[i] as EventType;
    const payload = data[i + 1];
    if (!Array.isArray(payload)) continue;
    const fields = agreedFields[eventType] ?? REQUESTED_FIELDS[eventType];
    if (!fields) continue;
    const symbolIdx = fields.indexOf("eventSymbol");
    if (symbolIdx === -1) continue;
    for (let j = 0; j + fields.length <= payload.length; j += fields.length) {
      const sym = payload[j + symbolIdx];
      if (typeof sym !== "string" || !symbolMap.has(sym)) continue;
      const record = extractRecord(eventType, payload, j, fields);
      mergeRecord(buffer, sym, eventType, record);
    }
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

const mergeRecord = (
  buffer: Buffer,
  sym: string,
  type: EventType,
  rec: QuoteFields | GreeksFields,
): void => {
  let entry = buffer.get(sym);
  if (!entry) {
    entry = { types: new Set() };
    buffer.set(sym, entry);
  }
  if (type === "Quote") entry.quote = rec as QuoteFields;
  else entry.greeks = rec as GreeksFields;
  entry.types.add(type);
};

// DXLink Quote `time` is ms since epoch. Treat anything < 2001-01-01 as bogus.
const MIN_VALID_EPOCH_MS = 978307200000;
const epochMsToIso = (ms: number | null): string | null => {
  if (ms === null || !Number.isFinite(ms) || ms < MIN_VALID_EPOCH_MS) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
};

const numOrNull = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    if (v === "NaN" || v === "" || v === "Infinity" || v === "-Infinity") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

// Legacy export for tooling that imported the old name.
export const getQuoteSnapshot = getMarketSnapshot;
export type QuoteSnapshot = MarketSnapshot;
