import { describe, expect, it } from "vitest";

import { BASE_URLS, loadConfig, isConfigured, setupInstructions } from "#/config";

describe("loadConfig", () => {
  // This used to assert that loadConfig throws. It deliberately no longer does:
  // a server that exits at startup surfaces in the client as a bare
  // "MCP error -32000: Connection closed" with stderr swallowed, so the message
  // explaining what to configure never reaches anyone. Missing configuration is
  // now a state, reported through tastytrade_auth_status.
  it("does not throw when nothing is configured, so the server can still start", () => {
    const cfg = loadConfig({} as NodeJS.ProcessEnv);
    expect(isConfigured(cfg)).toBe(false);
    const steps = setupInstructions(cfg).join(" ");
    expect(steps).toContain("TASTYTRADE_CLIENT_SECRET");
    expect(steps).toContain("TASTYTRADE_REFRESH_TOKEN");
  });

  it("reports configured once both credentials are present", () => {
    const cfg = loadConfig({
      TASTYTRADE_CLIENT_SECRET: "sec",
      TASTYTRADE_REFRESH_TOKEN: "ref",
    } as NodeJS.ProcessEnv);
    expect(isConfigured(cfg)).toBe(true);
    expect(setupInstructions(cfg)).toEqual([]);
  });

  it("defaults env to prod and trading to off", () => {
    const cfg = loadConfig({
      TASTYTRADE_CLIENT_SECRET: "s",
      TASTYTRADE_REFRESH_TOKEN: "r",
    } as NodeJS.ProcessEnv);
    expect(cfg.env).toBe("prod");
    expect(cfg.baseUrl).toBe(BASE_URLS.prod);
    expect(cfg.allowTrading).toBe(false);
    expect(cfg.scope).toBe("read trade");
  });

  it("switches base URL when env=cert", () => {
    const cfg = loadConfig({
      TASTYTRADE_CLIENT_SECRET: "s",
      TASTYTRADE_REFRESH_TOKEN: "r",
      TASTYTRADE_ENV: "cert",
    } as NodeJS.ProcessEnv);
    expect(cfg.baseUrl).toBe(BASE_URLS.cert);
  });

  it("enables trading on TASTYTRADE_ALLOW_TRADING=1", () => {
    const cfg = loadConfig({
      TASTYTRADE_CLIENT_SECRET: "s",
      TASTYTRADE_REFRESH_TOKEN: "r",
      TASTYTRADE_ALLOW_TRADING: "1",
    } as NodeJS.ProcessEnv);
    expect(cfg.allowTrading).toBe(true);
    expect(cfg.dangerouslyAllowTrading).toBe(false);
  });

  it("DANGEROUSLY_ALLOW_TRADING implies ALLOW_TRADING", () => {
    const cfg = loadConfig({
      TASTYTRADE_CLIENT_SECRET: "s",
      TASTYTRADE_REFRESH_TOKEN: "r",
      TASTYTRADE_DANGEROUSLY_ALLOW_TRADING: "1",
    } as NodeJS.ProcessEnv);
    expect(cfg.allowTrading).toBe(true);
    expect(cfg.dangerouslyAllowTrading).toBe(true);
  });
});
