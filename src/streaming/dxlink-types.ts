// Shared types and constants for DXLink streaming.
// Kept separate to prevent circular imports between dxlink-session and dxlink-snapshot.

import { isOption } from "./symbol.js";

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

export const REQUESTED_FIELDS: Record<EventType, string[]> = {
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
