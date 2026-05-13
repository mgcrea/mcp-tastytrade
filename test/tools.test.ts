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

type CapturedTool = { name: string; schema: Record<string, unknown> };

const captureTools = (
  allowTrading: boolean,
  dangerouslyAllowTrading = false,
): { names: string[]; tools: CapturedTool[] } => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const tools: CapturedTool[] = [];
  const original = server.tool.bind(server) as McpServer["tool"];
  vi.spyOn(server, "tool").mockImplementation(((...args: unknown[]) => {
    // server.tool(name, description, paramsShape, handler)
    tools.push({ name: args[0] as string, schema: args[2] as Record<string, unknown> });
    return (original as (...a: unknown[]) => unknown)(...args);
  }) as McpServer["tool"]);
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
    session,
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
    expect(names).toContain("list_accounts");
    expect(names).toContain("get_balances");
    expect(names).toContain("get_positions");
    expect(names).toContain("list_orders");
    expect(names).toContain("get_quote");
    expect(names).toContain("get_quotes");
    expect(names).toContain("get_option_chain");
    expect(names).toContain("get_option_chain_summary");
    expect(names).toContain("get_expected_move");
    expect(names).toContain("get_position_greeks");
    expect(names).toContain("get_chain_with_greeks");
    expect(names).toContain("find_strikes_by_delta");
    expect(names).toContain("get_earnings_calendar");
    expect(names).toContain("get_diagnostics");
    // dry_run_order was folded into place_order(confirm:false)
    expect(names).not.toContain("dry_run_order");
    expect(names).not.toContain("place_order");
    expect(names).not.toContain("cancel_order");
    expect(names).not.toContain("cancel_all_orders");
    expect(names).not.toContain("create_watchlist");
    expect(names).not.toContain("delete_watchlist");
  });

  it("registers mutating tools when trading is enabled", () => {
    const names = captureToolNames(true);
    expect(names).toContain("place_order");
    expect(names).toContain("cancel_order");
    expect(names).toContain("cancel_all_orders");
    expect(names).toContain("replace_order");
    expect(names).toContain("create_watchlist");
    expect(names).toContain("update_watchlist");
    expect(names).toContain("delete_watchlist");
  });

  it("flips confirm default to true when dangerouslyAllowTrading is set", async () => {
    const { tools } = captureTools(true, true);
    const place = tools.find((t) => t.name === "place_order");
    expect(place).toBeDefined();
    // The confirm field is a zod schema; parse with no arg → uses its default
    const confirmSchema = place!.schema.confirm as { parse: (v: unknown) => unknown };
    expect(confirmSchema.parse(undefined)).toBe(true);

    const cancel = tools.find((t) => t.name === "cancel_order");
    const cancelConfirm = cancel!.schema.confirm as { parse: (v: unknown) => unknown };
    expect(cancelConfirm.parse(undefined)).toBe(true);
  });

  it("keeps confirm default at false when dangerouslyAllowTrading is off", () => {
    const { tools } = captureTools(true, false);
    const place = tools.find((t) => t.name === "place_order");
    const confirmSchema = place!.schema.confirm as { parse: (v: unknown) => unknown };
    expect(confirmSchema.parse(undefined)).toBe(false);
  });
});
