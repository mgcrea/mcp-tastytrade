import { z } from "zod";

export const TastytradeEnv = z.enum(["prod", "cert"]);
export type TastytradeEnv = z.infer<typeof TastytradeEnv>;

export const BASE_URLS: Record<TastytradeEnv, string> = {
  prod: "https://api.tastyworks.com",
  cert: "https://api.cert.tastyworks.com",
};

const ConfigSchema = z.object({
  clientSecret: z.string().min(1, "TASTYTRADE_CLIENT_SECRET is required"),
  refreshToken: z.string().min(1, "TASTYTRADE_REFRESH_TOKEN is required"),
  scope: z.string().min(1).default("read trade"),
  env: TastytradeEnv.default("prod"),
  baseUrl: z.string().url().optional(),
  allowTrading: z.boolean().default(false),
  dangerouslyAllowTrading: z.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema> & { baseUrl: string };

const isTruthy = (v: string | undefined): boolean => v === "1" || v === "true";

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
  });

  return {
    ...parsed,
    baseUrl: parsed.baseUrl ?? BASE_URLS[parsed.env],
  };
};
