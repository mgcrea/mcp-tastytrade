import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { TastytradeHttpClient } from "../client/http.js";
import type { Config } from "../config.js";
import type { DiagnosticsRecorder } from "../lib/diagnostics.js";
import type { MarketDataProvider } from "../streaming/market-data-provider.js";
import { registerAccountTools } from "./accounts.js";
import { registerDiagnosticsTool } from "./diagnostics.js";
import { registerInstrumentTools } from "./instruments.js";
import { registerOrderReadTools, registerOrderWriteTools } from "./orders.js";
import { registerQuoteTools } from "./quotes.js";
import { registerTransactionTools } from "./transactions.js";
import { registerWatchlistReadTools, registerWatchlistWriteTools } from "./watchlists.js";

export type ToolContext = {
  http: TastytradeHttpClient;
  provider: MarketDataProvider;
  recorder: DiagnosticsRecorder;
  config: Config;
  serverVersion: string;
  allowTrading: boolean;
  dangerouslyAllowTrading?: boolean;
};

export const registerTools = (server: McpServer, ctx: ToolContext): void => {
  registerAccountTools(server, ctx.http, ctx.provider);
  registerInstrumentTools(server, ctx.http, ctx.provider);
  registerTransactionTools(server, ctx.http);
  registerOrderReadTools(server, ctx.http);
  registerWatchlistReadTools(server, ctx.http);
  registerQuoteTools(server, ctx.provider);
  registerDiagnosticsTool(server, ctx);

  if (ctx.allowTrading) {
    const skipConfirm = ctx.dangerouslyAllowTrading ?? false;
    registerOrderWriteTools(server, ctx.http, skipConfirm);
    registerWatchlistWriteTools(server, ctx.http, skipConfirm);
  }
};
