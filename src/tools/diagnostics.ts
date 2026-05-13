import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { BUILD_INFO } from "../build-info.js";
import type { ToolContext } from "./index.js";
import { wrap } from "./util.js";

export const registerDiagnosticsTool = (server: McpServer, ctx: ToolContext): void => {
  server.tool(
    "get_diagnostics",
    "Inspect server state and recent logs to debug failing tools. Returns the long-lived DXLink session state (connection state, subscription counts, recent reconnect / unauthorized attempts, last error), OAuth token freshness (no secret values), server build info, and the last N log lines (debug/warn/error). No token values, credentials, or PII are returned.",
    {
      logLimit: z
        .number()
        .int()
        .nonnegative()
        .max(500)
        .optional()
        .describe("How many recent log lines to include (default 200)."),
    },
    async ({ logLimit }) =>
      wrap(async () => ({
        server: {
          name: BUILD_INFO.name,
          version: BUILD_INFO.version,
          gitCommit: BUILD_INFO.gitCommit,
          gitCommitDate: BUILD_INFO.gitCommitDate,
          nodeVersion: process.version,
          env: ctx.config.env,
          baseUrl: ctx.config.baseUrl,
          scope: ctx.config.scope,
          allowTrading: ctx.config.allowTrading,
          dangerouslyAllowTrading: ctx.config.dangerouslyAllowTrading,
          dxlinkIdleTimeoutMs: ctx.config.dxlinkIdleTimeoutMs,
          dxlinkVersion: ctx.config.dxlinkVersion,
        },
        oauth: ctx.http.accessToken.info(),
        dxlink: ctx.session.getDiagnostics(),
        recentLogs: ctx.recorder.recent(logLimit),
      })),
  );
};
