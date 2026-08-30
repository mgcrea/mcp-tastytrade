import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { isConfigured, setupInstructions, type Config } from "#/config";
import { wrap } from "#/tools/util";

/**
 * Registered unconditionally, before any credential check, so an unconfigured
 * server answers "here is what to set" instead of closing the connection with
 * its own explanation swallowed.
 */
export const registerStatusTool = (server: McpServer, config: Config): void => {
  server.registerTool(
    "tastytrade_auth_status",
    {
      title: "TastyTrade: Auth Status",
      description:
        "Report whether this server has working TastyTrade credentials, which environment it " +
        "points at, whether trading is enabled, and — when something is missing — exactly what " +
        "to set. Call this first when a tool you expected is not listed: an absent tool here " +
        "means missing configuration rather than a bug.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      wrap(async () => ({
        configured: isConfigured(config),
        environment: config.env,
        baseUrl: config.baseUrl,
        trading: config.allowTrading ? "ENABLED" : "disabled",
        setup: setupInstructions(config),
      })),
  );
};
