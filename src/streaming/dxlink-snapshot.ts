import WebSocket from "ws";

import { getApiQuoteToken } from "../client/endpoints/quote-tokens.js";
import type { TastytradeHttpClient } from "../client/http.js";

export type QuoteSnapshot = {
  symbol: string;
  bidPrice: number | null;
  askPrice: number | null;
  bidSize: number | null;
  askSize: number | null;
  eventTime: number | null;
};

type Outgoing = Record<string, unknown> & { type: string; channel?: number };

const CHANNEL = 3;
const REQUESTED_FIELDS = [
  "eventType",
  "eventSymbol",
  "bidPrice",
  "askPrice",
  "bidSize",
  "askSize",
  "time",
] as const;

export const getQuoteSnapshot = async (
  http: TastytradeHttpClient,
  symbol: string,
  opts: { timeoutMs?: number } = {},
): Promise<QuoteSnapshot> => {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const { token, dxlinkUrl } = await getApiQuoteToken(http);

  const ws = new WebSocket(dxlinkUrl);
  const send = (msg: Outgoing): void => {
    ws.send(JSON.stringify(msg));
  };

  let agreedFields: string[] | null = null;
  let subscribed = false;

  return new Promise<QuoteSnapshot>((resolve, reject) => {
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
      cleanup();
      reject(new Error(`Timed out waiting for quote on ${symbol}`));
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
        case "CHANNEL_OPENED":
          send({
            type: "FEED_SETUP",
            channel: CHANNEL,
            acceptAggregationPeriod: 0.1,
            acceptDataFormat: "COMPACT",
            acceptEventFields: { Quote: REQUESTED_FIELDS },
          });
          break;
        case "FEED_CONFIG": {
          const eventFields = (msg.eventFields as { Quote?: string[] } | undefined)?.Quote;
          if (eventFields) agreedFields = eventFields;
          if (!subscribed) {
            subscribed = true;
            send({
              type: "FEED_SUBSCRIPTION",
              channel: CHANNEL,
              reset: true,
              add: [{ type: "Quote", symbol }],
            });
          }
          break;
        }
        case "FEED_DATA": {
          const fields = agreedFields ?? [...REQUESTED_FIELDS];
          const quote = parseCompactQuoteData(msg.data, fields, symbol);
          if (quote) {
            cleanup();
            resolve(quote);
          }
          break;
        }
        default:
          break;
      }
    });
  });
};

const parseCompactQuoteData = (
  data: unknown,
  fields: string[],
  expected: string,
): QuoteSnapshot | null => {
  if (!Array.isArray(data) || data.length < 2) return null;
  const symbolIdx = fields.indexOf("eventSymbol");
  if (symbolIdx === -1 || fields.length === 0) return null;
  // COMPACT format: [eventType, [v1, v2, ..., vN, v1, v2, ..., vN, ...]]
  for (let i = 0; i + 1 < data.length; i += 2) {
    const eventType = data[i];
    const payload = data[i + 1];
    if (eventType !== "Quote" || !Array.isArray(payload)) continue;
    for (let j = 0; j + fields.length <= payload.length; j += fields.length) {
      if (payload[j + symbolIdx] !== expected) continue;
      return {
        symbol: expected,
        bidPrice: numOrNull(payload[j + fields.indexOf("bidPrice")]),
        askPrice: numOrNull(payload[j + fields.indexOf("askPrice")]),
        bidSize: numOrNull(payload[j + fields.indexOf("bidSize")]),
        askSize: numOrNull(payload[j + fields.indexOf("askSize")]),
        eventTime: numOrNull(payload[j + fields.indexOf("time")]),
      };
    }
  }
  return null;
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
