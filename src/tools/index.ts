import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { TastytradeHttpClient } from "../client/http.js";
import type { DxlinkSession } from "../streaming/dxlink-session.js";
import { registerAccountTools } from "./accounts.js";
import { registerInstrumentTools } from "./instruments.js";
import { registerOrderReadTools, registerOrderWriteTools } from "./orders.js";
import { registerQuoteTools } from "./quotes.js";
import { registerTransactionTools } from "./transactions.js";
import { registerWatchlistReadTools, registerWatchlistWriteTools } from "./watchlists.js";

export type ToolContext = {
  http: TastytradeHttpClient;
  session: DxlinkSession;
  allowTrading: boolean;
  dangerouslyAllowTrading?: boolean;
};

export const registerTools = (server: McpServer, ctx: ToolContext): void => {
  registerAccountTools(server, ctx.http, ctx.session);
  registerInstrumentTools(server, ctx.http, ctx.session);
  registerTransactionTools(server, ctx.http);
  registerOrderReadTools(server, ctx.http);
  registerWatchlistReadTools(server, ctx.http);
  registerQuoteTools(server, ctx.session);

  if (ctx.allowTrading) {
    const skipConfirm = ctx.dangerouslyAllowTrading ?? false;
    registerOrderWriteTools(server, ctx.http, skipConfirm);
    registerWatchlistWriteTools(server, ctx.http, skipConfirm);
  }
};
