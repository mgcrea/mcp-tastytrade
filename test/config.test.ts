import { describe, expect, it } from "vitest";

import { BASE_URLS, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("requires client secret and refresh token", () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow();
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
  });
});
