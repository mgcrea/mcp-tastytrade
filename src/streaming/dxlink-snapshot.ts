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
      let msg: { type?: string; channel?: number; data?: unknown };
      try {
        msg = JSON.parse(raw.toString()) as { type?: string; channel?: number; data?: unknown };
      } catch {
        return;
      }
      switch (msg.type) {
        case "SETUP":
          send({ type: "AUTH", channel: 0, token });
          break;
        case "AUTH_STATE":
          if ((msg as { state?: string }).state === "AUTHORIZED") {
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
            acceptEventFields: {
              Quote: [
                "eventType",
                "eventSymbol",
                "bidPrice",
                "askPrice",
                "bidSize",
                "askSize",
                "time",
              ],
            },
          });
          break;
        case "FEED_CONFIG":
          send({
            type: "FEED_SUBSCRIPTION",
            channel: CHANNEL,
            reset: true,
            add: [{ type: "Quote", symbol }],
          });
          break;
        case "FEED_DATA": {
          const quote = parseCompactQuoteData(msg.data, symbol);
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

const parseCompactQuoteData = (data: unknown, expected: string): QuoteSnapshot | null => {
  if (!Array.isArray(data) || data.length < 2) return null;
  // COMPACT format: [eventType, [field1, field2, ...]] where the inner array
  // contains repeated records, each with the fields requested in FEED_SETUP.
  const [eventType, payload] = data as [unknown, unknown];
  if (eventType !== "Quote" || !Array.isArray(payload)) return null;
  const fieldCount = 7; // eventType, eventSymbol, bidPrice, askPrice, bidSize, askSize, time
  for (let i = 0; i + fieldCount <= payload.length; i += fieldCount) {
    const sym = payload[i + 1];
    if (sym !== expected) continue;
    return {
      symbol: expected,
      bidPrice: numOrNull(payload[i + 2]),
      askPrice: numOrNull(payload[i + 3]),
      bidSize: numOrNull(payload[i + 4]),
      askSize: numOrNull(payload[i + 5]),
      eventTime: numOrNull(payload[i + 6]),
    };
  }
  return null;
};

const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
