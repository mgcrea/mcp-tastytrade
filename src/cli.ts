#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { BUILD_INFO } from "./build-info.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

const stderrLogger = {
  debug: (...args: unknown[]) => {
    if (process.env.TASTYTRADE_DEBUG) console.error("[tastytrade-mcp]", ...args);
  },
  warn: (...args: unknown[]) => console.error("[tastytrade-mcp]", ...args),
  error: (...args: unknown[]) => console.error("[tastytrade-mcp]", ...args),
};

const main = async (): Promise<void> => {
  stderrLogger.warn(
    `${BUILD_INFO.name}@${BUILD_INFO.version} (git ${BUILD_INFO.gitCommit} ${BUILD_INFO.gitCommitDate}, node ${process.version})`,
  );
  const config = loadConfig();
  const { server, provider } = createServer({ config, logger: stderrLogger });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const tradingMode = config.dangerouslyAllowTrading
    ? "DANGEROUSLY-AUTO-SUBMIT"
    : config.allowTrading
      ? "on"
      : "off";
  stderrLogger.warn(`tastytrade-mcp connected (env=${config.env}, trading=${tradingMode})`);
  if (config.dangerouslyAllowTrading) {
    stderrLogger.warn(
      "⚠️  TASTYTRADE_DANGEROUSLY_ALLOW_TRADING=1 — orders submit immediately, no confirm gate.",
    );
  }

  const shutdown = async (signal: string): Promise<void> => {
    stderrLogger.warn(`received ${signal}, closing session`);
    await provider.close?.();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

main().catch((err: unknown) => {
  console.error("[tastytrade-mcp] fatal:", err);
  process.exit(1);
});
