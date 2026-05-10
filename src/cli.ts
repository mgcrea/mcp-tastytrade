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
  stderrLogger.warn(
    `tastytrade-mcp connected (env=${config.env}, trading=${config.allowTrading ? "on" : "off"})`,
  );
};

main().catch((err: unknown) => {
  console.error("[tastytrade-mcp] fatal:", err);
  process.exit(1);
});
