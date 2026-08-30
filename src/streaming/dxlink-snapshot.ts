// Snapshot wrappers around a MarketDataProvider (DXLink streaming or REST).
// The provider owns the connection lifecycle; these helpers exist for tool ergonomics.

import type { EventType, MarketSnapshot } from "#/streaming/dxlink-types";
import type { MarketDataProvider } from "#/streaming/market-data-provider";

export type {
  EventType,
  GreeksFields,
  MarketSnapshot,
  QuoteFields,
} from "#/streaming/dxlink-types";
export { REQUESTED_FIELDS, defaultTypesForSymbol } from "#/streaming/dxlink-types";

export type SnapshotOptions = {
  types?: EventType[];
  timeoutMs?: number;
};

export const getMarketSnapshot = async (
  provider: MarketDataProvider,
  symbol: string,
  opts: SnapshotOptions = {},
): Promise<MarketSnapshot> => {
  const [result] = await provider.snapshot([symbol], opts.types, opts.timeoutMs);
  if (!result) throw new Error(`No snapshot returned for ${symbol}`);
  return result;
};

export const getMarketSnapshots = (
  provider: MarketDataProvider,
  symbols: string[],
  opts: SnapshotOptions = {},
): Promise<MarketSnapshot[]> => provider.snapshot(symbols, opts.types, opts.timeoutMs);
