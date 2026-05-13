// Snapshot wrappers around a MarketDataProvider (DXLink streaming or REST).
// The provider owns the connection lifecycle; these helpers exist for tool ergonomics.

import type { EventType, MarketSnapshot } from "./dxlink-types.js";
import type { MarketDataProvider } from "./market-data-provider.js";

export type { EventType, GreeksFields, MarketSnapshot, QuoteFields } from "./dxlink-types.js";
export { REQUESTED_FIELDS, defaultTypesForSymbol } from "./dxlink-types.js";

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
