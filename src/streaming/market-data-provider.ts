// Common interface for snapshot retrieval. Two implementations:
//   - DxlinkSession (streaming, Quote + Greeks via WebSocket)
//   - RestMarketDataProvider (REST `/market-data/by-type`, Quote only)
//
// Tools call the provider, never DxlinkSession directly, so REST mode can
// substitute for streaming when DXLink is unavailable.

import type { EventType, MarketSnapshot } from "./dxlink-types.js";

export type ProviderMode = "dxlink" | "rest";

export type MarketDataProvider = {
  readonly mode: ProviderMode;
  snapshot(symbols: string[], types?: EventType[], timeoutMs?: number): Promise<MarketSnapshot[]>;
  getDiagnostics(): Record<string, unknown>;
  close?(): Promise<void> | void;
};
