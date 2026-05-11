#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

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
  const config = loadConfig();
  const server = createServer({ config, logger: stderrLogger });
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
};

main().catch((err: unknown) => {
  console.error("[tastytrade-mcp] fatal:", err);
  process.exit(1);
});
