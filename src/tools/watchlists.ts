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
} from "../client/endpoints/watchlists.js";
import type { TastytradeHttpClient } from "../client/http.js";
import { wrap } from "./util.js";

const WatchlistBodySchema = z.object({
  name: z.string().min(1),
  groupName: z.string().optional(),
  orderIndex: z.number().int().optional(),
  watchlistEntries: z
    .array(z.object({ symbol: z.string(), instrumentType: z.string().optional() }))
    .default([]),
});

export const registerWatchlistReadTools = (server: McpServer, http: TastytradeHttpClient): void => {
  server.tool("list_watchlists", "List the user's private watchlists.", {}, async () =>
    wrap(() => listWatchlists(http)),
  );
  server.tool(
    "get_watchlist",
    "Get a private watchlist by name.",
    { name: z.string() },
    async ({ name }) => wrap(() => getWatchlist(http, name)),
  );
  server.tool(
    "list_public_watchlists",
    "List TastyTrade-published public watchlists.",
    {},
    async () => wrap(() => listPublicWatchlists(http)),
  );
  server.tool(
    "get_public_watchlist",
    "Get a public watchlist by name.",
    { name: z.string() },
    async ({ name }) => wrap(() => getPublicWatchlist(http, name)),
  );
};

export const registerWatchlistWriteTools = (
  server: McpServer,
  http: TastytradeHttpClient,
): void => {
  server.tool(
    "create_watchlist",
    "Create a private watchlist.",
    { body: WatchlistBodySchema },
    async ({ body }) => wrap(() => createWatchlist(http, body as WatchlistBody)),
  );
  server.tool(
    "update_watchlist",
    "Update a private watchlist by name (replaces entries).",
    { name: z.string(), body: WatchlistBodySchema },
    async ({ name, body }) => wrap(() => updateWatchlist(http, name, body as WatchlistBody)),
  );
  server.tool(
    "delete_watchlist",
    "Delete a private watchlist by name.",
    { name: z.string(), confirm: z.boolean().default(false) },
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
