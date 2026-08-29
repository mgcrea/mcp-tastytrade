import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";

import { TastytradeHttpClient } from "../src/client/http.js";
import { BASE_URLS } from "../src/config.js";
import { DiagnosticsRecorder } from "../src/lib/diagnostics.js";
import { DxlinkSession } from "../src/streaming/dxlink-session.js";
import { registerTools } from "../src/tools/index.js";

const stubFetch = vi.fn(
  async () =>
    new Response(JSON.stringify({ access_token: "t", expires_in: 900 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
) as unknown as typeof fetch;

const buildHttp = () =>
  new TastytradeHttpClient({
    baseUrl: "https://api.example.com",
    oauth: { clientSecret: "sec", refreshToken: "ref", scope: "read" },
    fetch: stubFetch,
  });

type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
};

type CapturedTool = {
  name: string;
  schema: Record<string, unknown>;
  annotations: ToolAnnotations | undefined;
};

const captureTools = (
  allowTrading: boolean,
  dangerouslyAllowTrading = false,
): { names: string[]; tools: CapturedTool[] } => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const tools: CapturedTool[] = [];
  const original = server.registerTool.bind(server) as McpServer["registerTool"];
  vi.spyOn(server, "registerTool").mockImplementation(((...args: unknown[]) => {
    // server.registerTool(name, { description, inputSchema, annotations }, handler)
    const options = args[1] as {
      inputSchema?: Record<string, unknown>;
      annotations?: ToolAnnotations;
    };
    tools.push({
      name: args[0] as string,
      schema: options.inputSchema ?? {},
      annotations: options.annotations,
    });
    return (original as (...a: unknown[]) => unknown)(...args);
  }) as McpServer["registerTool"]);
  const http = buildHttp();
  const session = new DxlinkSession(http, {
    // Tests never actually fire a WS — but supply a stub factory so the type-check holds.
    wsFactory: () => ({
      on: () => undefined,
      send: () => undefined,
      close: () => undefined,
    }),
    getToken: async () => ({ token: "t", dxlinkUrl: "wss://dxlink.example/" }),
  });
  registerTools(server, {
    http,
    provider: session,
    recorder: new DiagnosticsRecorder(),
    serverVersion: "0.0.0",
    config: {
      clientSecret: "sec",
      refreshToken: "ref",
      scope: "read",
      env: "prod",
      baseUrl: BASE_URLS.prod,
      allowTrading,
      dangerouslyAllowTrading,
      dxlinkIdleTimeoutMs: 30_000,
      dxlinkVersion: "0.1-test/0.0.0",
      disableDxlink: false,
    },
    allowTrading,
    dangerouslyAllowTrading,
  });
  return { names: tools.map((t) => t.name), tools };
};

const captureToolNames = (allowTrading: boolean): string[] => captureTools(allowTrading).names;

describe("tool registration", () => {
  it("registers read-only tools by default", () => {
    const names = captureToolNames(false);
    expect(names).toContain("tastytrade_list_accounts");
    expect(names).toContain("tastytrade_get_balances");
    expect(names).toContain("tastytrade_get_positions");
    expect(names).toContain("tastytrade_list_orders");
    expect(names).toContain("tastytrade_get_complex_order");
    expect(names).toContain("tastytrade_get_quote");
    expect(names).toContain("tastytrade_get_quotes");
    expect(names).toContain("tastytrade_get_option_chain");
    expect(names).toContain("tastytrade_get_option_chain_summary");
    expect(names).toContain("tastytrade_get_expected_move");
    expect(names).toContain("tastytrade_get_position_greeks");
    expect(names).toContain("tastytrade_get_chain_with_greeks");
    expect(names).toContain("tastytrade_find_strikes_by_delta");
    expect(names).toContain("tastytrade_get_earnings_calendar");
    expect(names).toContain("tastytrade_get_diagnostics");
    // dry_run_order was folded into tastytrade_place_order(confirm:false)
    expect(names).not.toContain("dry_run_order");
    expect(names).not.toContain("tastytrade_place_order");
    expect(names).not.toContain("tastytrade_cancel_order");
    expect(names).not.toContain("tastytrade_cancel_all_orders");
    expect(names).not.toContain("tastytrade_create_watchlist");
    expect(names).not.toContain("tastytrade_delete_watchlist");
  });

  it("registers mutating tools when trading is enabled", () => {
    const names = captureToolNames(true);
    expect(names).toContain("tastytrade_place_order");
    expect(names).toContain("tastytrade_cancel_order");
    expect(names).toContain("tastytrade_cancel_all_orders");
    expect(names).toContain("tastytrade_replace_order");
    expect(names).toContain("tastytrade_place_complex_order");
    expect(names).toContain("tastytrade_cancel_complex_order");
    expect(names).toContain("tastytrade_create_watchlist");
    expect(names).toContain("tastytrade_update_watchlist");
    expect(names).toContain("tastytrade_delete_watchlist");
  });

  it("flips confirm default to true when dangerouslyAllowTrading is set", async () => {
    const { tools } = captureTools(true, true);
    const place = tools.find((t) => t.name === "tastytrade_place_order");
    expect(place).toBeDefined();
    // The confirm field is a zod schema; parse with no arg → uses its default
    const confirmSchema = place!.schema.confirm as { parse: (v: unknown) => unknown };
    expect(confirmSchema.parse(undefined)).toBe(true);

    const cancel = tools.find((t) => t.name === "tastytrade_cancel_order");
    const cancelConfirm = cancel!.schema.confirm as { parse: (v: unknown) => unknown };
    expect(cancelConfirm.parse(undefined)).toBe(true);
  });

  it("keeps confirm default at false when dangerouslyAllowTrading is off", () => {
    const { tools } = captureTools(true, false);
    const place = tools.find((t) => t.name === "tastytrade_place_order");
    const confirmSchema = place!.schema.confirm as { parse: (v: unknown) => unknown };
    expect(confirmSchema.parse(undefined)).toBe(false);
  });
});

describe("tool annotations", () => {
  // The reason this migration happened: every tool used the positional
  // server.tool() API, which has no slot for annotations, so all 41 shipped
  // unannotated on a server that places and cancels live brokerage orders. A
  // client had no way to tell tastytrade_get_account from tastytrade_cancel_order.
  it("annotates every registered tool", () => {
    const { tools } = captureTools(true, true);
    const missing = tools.filter((t) => t.annotations === undefined).map((t) => t.name);
    expect(missing).toEqual([]);
    expect(tools.length).toBeGreaterThan(30);
  });

  it("marks the read tools read-only", () => {
    const { tools } = captureTools(true, true);
    for (const name of [
      "tastytrade_list_accounts",
      "tastytrade_get_positions",
      "tastytrade_get_quote",
      "tastytrade_list_orders",
    ]) {
      expect(tools.find((t) => t.name === name)?.annotations?.readOnlyHint, name).toBe(true);
    }
  });

  it("marks order cancellation destructive, and placement non-idempotent", () => {
    const { tools } = captureTools(true, true);
    const ann = (name: string) => tools.find((t) => t.name === name)?.annotations;

    for (const name of [
      "tastytrade_cancel_order",
      "tastytrade_cancel_all_orders",
      "tastytrade_cancel_complex_order",
    ]) {
      expect(ann(name)?.destructiveHint, name).toBe(true);
      expect(ann(name)?.readOnlyHint, name).toBe(false);
    }
    // Placing an order twice places two orders — never idempotent, and not
    // destructive because it removes nothing.
    for (const name of ["tastytrade_place_order", "tastytrade_place_complex_order"]) {
      expect(ann(name)?.idempotentHint, name).toBe(false);
      expect(ann(name)?.destructiveHint, name).toBe(false);
      expect(ann(name)?.readOnlyHint, name).toBe(false);
    }
    // Replacing overwrites a live order, so it destroys the previous one.
    expect(ann("tastytrade_replace_order")?.destructiveHint).toBe(true);
  });

  it("never marks a trading tool read-only", () => {
    const { tools } = captureTools(true, true);
    const trading = tools.filter((t) => /^tastytrade_(place|cancel|replace)_/.test(t.name));
    expect(trading.length).toBeGreaterThan(0);
    for (const t of trading) expect(t.annotations?.readOnlyHint, t.name).toBe(false);
  });
});
