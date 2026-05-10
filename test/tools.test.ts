import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { TastytradeHttpClient } from "../src/client/http.js";
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

const captureToolNames = (allowTrading: boolean): string[] => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const names: string[] = [];
  const original = server.tool.bind(server) as McpServer["tool"];
  vi.spyOn(server, "tool").mockImplementation(((...args: unknown[]) => {
    names.push(args[0] as string);
    return (original as (...a: unknown[]) => unknown)(...args);
  }) as McpServer["tool"]);
  registerTools(server, { http: buildHttp(), allowTrading });
  return names;
};

describe("tool registration", () => {
  it("registers read-only tools by default", () => {
    const names = captureToolNames(false);
    expect(names).toContain("list_accounts");
    expect(names).toContain("get_balances");
    expect(names).toContain("get_positions");
    expect(names).toContain("list_orders");
    expect(names).toContain("dry_run_order");
    expect(names).toContain("get_quote");
    expect(names).not.toContain("place_order");
    expect(names).not.toContain("cancel_order");
    expect(names).not.toContain("create_watchlist");
    expect(names).not.toContain("delete_watchlist");
  });

  it("registers mutating tools when trading is enabled", () => {
    const names = captureToolNames(true);
    expect(names).toContain("place_order");
    expect(names).toContain("cancel_order");
    expect(names).toContain("replace_order");
    expect(names).toContain("create_watchlist");
    expect(names).toContain("update_watchlist");
    expect(names).toContain("delete_watchlist");
  });
});
