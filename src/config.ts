import { z } from "zod";

import { BUILD_INFO } from "#/build-info";

export const TastytradeEnv = z.enum(["prod", "cert"]);

const DEFAULT_DXLINK_VERSION = `0.1-mcp-tastytrade-js/${BUILD_INFO.version}`;
export type TastytradeEnv = z.infer<typeof TastytradeEnv>;

export const BASE_URLS: Record<TastytradeEnv, string> = {
  prod: "https://api.tastyworks.com",
  cert: "https://api.cert.tastyworks.com",
};

const ConfigSchema = z.object({
  // Optional at the schema level so "nothing is configured" is a state the
  // server can report, not a crash before it ever connects — see loadConfig.
  clientSecret: z.string().min(1).optional(),
  refreshToken: z.string().min(1).optional(),
  scope: z.string().min(1).default("read trade"),
  env: TastytradeEnv.default("prod"),
  baseUrl: z.string().url().optional(),
  allowTrading: z.boolean().default(false),
  dangerouslyAllowTrading: z.boolean().default(false),
  dxlinkIdleTimeoutMs: z.number().int().positive().default(30_000),
  // SETUP `version` field sent to DXLink. Default identifies us as
  // "<protoVersion>-<clientName>/<clientVersion>", auto-tracked from
  // package.json. Override via env to mimic the official SDK
  // (e.g. "0.1-DXF-JS/0.3.0") when probing for server-side client
  // fingerprinting.
  dxlinkVersion: z.string().min(1).default(DEFAULT_DXLINK_VERSION),
  // Opt-in: skip DXLink entirely and serve quotes via REST `/market-data/by-type`.
  // Loses Greeks (delta/gamma/theta/...), but keeps `tastytrade_get_quote`, `tastytrade_get_quotes`,
  // `tastytrade_get_chain_with_greeks`, and `tastytrade_get_position_greeks` working when streaming
  // is broken.
  disableDxlink: z.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema> & { baseUrl: string };

const isTruthy = (v: string | undefined): boolean => v === "1" || v === "true";

const parseNumberOpt = (v: string | undefined): number | undefined => {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const dangerouslyAllowTrading = isTruthy(env.TASTYTRADE_DANGEROUSLY_ALLOW_TRADING);
  const parsed = ConfigSchema.parse({
    clientSecret: env.TASTYTRADE_CLIENT_SECRET,
    refreshToken: env.TASTYTRADE_REFRESH_TOKEN,
    scope: env.TASTYTRADE_SCOPE,
    env: env.TASTYTRADE_ENV,
    baseUrl: env.TASTYTRADE_BASE_URL,
    // dangerouslyAllowTrading implies allowTrading — otherwise the tools wouldn't even register.
    allowTrading: isTruthy(env.TASTYTRADE_ALLOW_TRADING) || dangerouslyAllowTrading,
    dangerouslyAllowTrading,
    dxlinkIdleTimeoutMs: parseNumberOpt(env.TASTYTRADE_DXLINK_IDLE_TIMEOUT_MS),
    dxlinkVersion: env.TASTYTRADE_DXLINK_VERSION,
    disableDxlink: isTruthy(env.TASTYTRADE_DISABLE_DXLINK),
  });

  return {
    ...parsed,
    baseUrl: parsed.baseUrl ?? BASE_URLS[parsed.env],
  };
};

/** True once the server can actually exchange the refresh token for a session. */
export const isConfigured = (config: Config): boolean =>
  Boolean(config.clientSecret && config.refreshToken);

/** Returned by tastytrade_auth_status and printed to stderr at startup. */
export const setupInstructions = (config: Config): string[] => {
  if (isConfigured(config)) return [];
  const missing: string[] = [];
  if (!config.clientSecret) missing.push("TASTYTRADE_CLIENT_SECRET");
  if (!config.refreshToken) missing.push("TASTYTRADE_REFRESH_TOKEN");
  return [
    `Set ${missing.join(" and ")}.`,
    "Create an OAuth client under My Profile → API in the TastyTrade web platform, then " +
      "complete the authorization flow once to obtain a refresh token.",
    "Then restart the server.",
  ];
};
