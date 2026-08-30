import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  createWatchlist,
  deleteWatchlist,
  getPublicWatchlist,
  getWatchlist,
  listPublicWatchlists,
  listWatchlists,
  updateWatchlist,
  type WatchlistBody,
} from "#/client/endpoints/watchlists";
import type { TastytradeHttpClient } from "#/client/http";
import { wrap } from "#/tools/util";

const WatchlistBodySchema = z.object({
  name: z.string().min(1),
  groupName: z.string().optional(),
  orderIndex: z.number().int().optional(),
  watchlistEntries: z
    .array(z.object({ symbol: z.string(), instrumentType: z.string().optional() }))
    .default([]),
});

export const registerWatchlistReadTools = (server: McpServer, http: TastytradeHttpClient): void => {
  server.registerTool(
    "tastytrade_list_watchlists",
    {
      title: "TastyTrade: List Watchlists",
      description: "List the user's private watchlists.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => wrap(() => listWatchlists(http)),
  );
  server.registerTool(
    "tastytrade_get_watchlist",
    {
      title: "TastyTrade: Get Watchlist",
      description: "Get a private watchlist by name.",
      inputSchema: { name: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => wrap(() => getWatchlist(http, name)),
  );
  server.registerTool(
    "tastytrade_list_public_watchlists",
    {
      title: "TastyTrade: List Public Watchlists",
      description: "List TastyTrade-published public watchlists.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => wrap(() => listPublicWatchlists(http)),
  );
  server.registerTool(
    "tastytrade_get_public_watchlist",
    {
      title: "TastyTrade: Get Public Watchlist",
      description: "Get a public watchlist by name.",
      inputSchema: { name: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => wrap(() => getPublicWatchlist(http, name)),
  );
};

export const registerWatchlistWriteTools = (
  server: McpServer,
  http: TastytradeHttpClient,
  skipConfirm = false,
): void => {
  server.registerTool(
    "tastytrade_create_watchlist",
    {
      title: "TastyTrade: Create Watchlist",
      description: "Create a private watchlist.",
      inputSchema: { body: WatchlistBodySchema },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ body }) => wrap(() => createWatchlist(http, body as WatchlistBody)),
  );
  server.registerTool(
    "tastytrade_update_watchlist",
    {
      title: "TastyTrade: Update Watchlist",
      description: "Update a private watchlist by name (replaces entries).",
      inputSchema: { name: z.string(), body: WatchlistBodySchema },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ name, body }) => wrap(() => updateWatchlist(http, name, body as WatchlistBody)),
  );
  server.registerTool(
    "tastytrade_delete_watchlist",
    {
      title: "TastyTrade: Delete Watchlist",
      description: skipConfirm
        ? "Delete a private watchlist. TASTYTRADE_DANGEROUSLY_ALLOW_TRADING=1 is set — deletes immediately by default."
        : "Delete a private watchlist by name.",
      inputSchema: { name: z.string(), confirm: z.boolean().default(skipConfirm) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ name, confirm }) =>
      wrap(async () => {
        if (!confirm) {
          return {
            deleted: false,
            message: `Re-call with confirm=true to delete watchlist "${name}".`,
          };
        }
        const result = await deleteWatchlist(http, name);
        return { deleted: true, result };
      }),
  );
};
