import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { TastytradeHttpClient, type Logger } from "./client/http.js";
import type { Config } from "./config.js";
import { registerTools } from "./tools/index.js";

export const SERVER_NAME = "@mgcrea/mcp-tastytrade";
export const SERVER_VERSION = "0.1.0";
export const USER_AGENT = "mcp-tastytrade-js";

export type CreateServerOptions = {
  config: Config;
  fetch?: typeof fetch;
  logger?: Logger;
};

export const createServer = (opts: CreateServerOptions): McpServer => {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const http = new TastytradeHttpClient({
    baseUrl: opts.config.baseUrl,
    oauth: {
      clientSecret: opts.config.clientSecret,
      refreshToken: opts.config.refreshToken,
      scope: opts.config.scope,
    },
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
    userAgent: USER_AGENT,
  });
  registerTools(server, {
    http,
    allowTrading: opts.config.allowTrading,
    dangerouslyAllowTrading: opts.config.dangerouslyAllowTrading,
  });
  return server;
};
