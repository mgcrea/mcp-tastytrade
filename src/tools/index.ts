import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { TastytradeHttpClient } from "#/client/http";
import type { Config } from "#/config";
import { isConfigured } from "#/config";
import type { DiagnosticsRecorder } from "#/lib/diagnostics";
import type { MarketDataProvider } from "#/streaming/market-data-provider";
import { registerAccountTools } from "#/tools/accounts";
import { registerDiagnosticsTool } from "#/tools/diagnostics";
import { registerInstrumentTools } from "#/tools/instruments";
import { registerOrderReadTools, registerOrderWriteTools } from "#/tools/orders";
import { registerQuoteTools } from "#/tools/quotes";
import { registerStatusTool } from "#/tools/status";
import { registerTransactionTools } from "#/tools/transactions";
import { registerWatchlistReadTools, registerWatchlistWriteTools } from "#/tools/watchlists";

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
  // Registered first and unconditionally, so an unconfigured server is still a
  // useful one — it can say what to set — rather than a connection that closes
  // with its own explanation swallowed.
  registerStatusTool(server, ctx.config);
  if (!isConfigured(ctx.config)) return;

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
