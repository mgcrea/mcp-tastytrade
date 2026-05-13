import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { TastytradeHttpClient, type Logger } from "./client/http.js";
import type { Config } from "./config.js";
import { DiagnosticsRecorder } from "./lib/diagnostics.js";
import { DxlinkSession } from "./streaming/dxlink-session.js";
import { registerTools } from "./tools/index.js";

export const SERVER_NAME = "@mgcrea/mcp-tastytrade";
export const SERVER_VERSION = "0.1.0";
export const USER_AGENT = "mcp-tastytrade-js";

export type CreateServerOptions = {
  config: Config;
  fetch?: typeof fetch;
  logger?: Logger;
};

export type CreatedServer = {
  server: McpServer;
  session: DxlinkSession;
  recorder: DiagnosticsRecorder;
};

const teeLogger = (base: Logger | undefined, recorder: DiagnosticsRecorder): Logger => ({
  debug: (...args: unknown[]) => {
    recorder.log("debug", args);
    base?.debug?.(...args);
  },
  warn: (...args: unknown[]) => {
    recorder.log("warn", args);
    base?.warn?.(...args);
  },
  error: (...args: unknown[]) => {
    recorder.log("error", args);
    base?.error?.(...args);
  },
});

export const createServer = (opts: CreateServerOptions): CreatedServer => {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const recorder = new DiagnosticsRecorder();
  const logger = teeLogger(opts.logger, recorder);
  const http = new TastytradeHttpClient({
    baseUrl: opts.config.baseUrl,
    oauth: {
      clientSecret: opts.config.clientSecret,
      refreshToken: opts.config.refreshToken,
      scope: opts.config.scope,
    },
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    logger,
    userAgent: USER_AGENT,
  });
  const session = new DxlinkSession(http, {
    idleTimeoutMs: opts.config.dxlinkIdleTimeoutMs,
    invalidateOAuth: () => http.accessToken.invalidate(),
    logger,
  });
  registerTools(server, {
    http,
    session,
    recorder,
    config: opts.config,
    serverVersion: SERVER_VERSION,
    allowTrading: opts.config.allowTrading,
    dangerouslyAllowTrading: opts.config.dangerouslyAllowTrading,
  });
  return { server, session, recorder };
};
