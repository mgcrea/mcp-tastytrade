// Snapshot wrappers around the long-lived DxlinkSession.
// The session owns the connection lifecycle; these helpers exist for tool ergonomics
// and to preserve the import surface used elsewhere in the codebase.

import type { DxlinkSession } from "./dxlink-session.js";
import type { EventType, MarketSnapshot } from "./dxlink-types.js";

export type {
  EventType,
  GreeksFields,
  MarketSnapshot,
  QuoteFields,
} from "./dxlink-types.js";
export { REQUESTED_FIELDS, defaultTypesForSymbol } from "./dxlink-types.js";

export type SnapshotOptions = {
  types?: EventType[];
  timeoutMs?: number;
};

export const getMarketSnapshot = async (
  session: DxlinkSession,
  symbol: string,
  opts: SnapshotOptions = {},
): Promise<MarketSnapshot> => {
  const [result] = await session.snapshot([symbol], opts.types, opts.timeoutMs);
  if (!result) throw new Error(`No snapshot returned for ${symbol}`);
  return result;
};

export const getMarketSnapshots = (
  session: DxlinkSession,
  symbols: string[],
  opts: SnapshotOptions = {},
): Promise<MarketSnapshot[]> => session.snapshot(symbols, opts.types, opts.timeoutMs);
