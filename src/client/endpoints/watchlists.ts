import type { TastytradeHttpClient } from "../http.js";

export type WatchlistEntry = { symbol: string; instrumentType?: string };

export type WatchlistBody = {
  name: string;
  groupName?: string;
  orderIndex?: number;
  watchlistEntries: WatchlistEntry[];
};

export const listWatchlists = (http: TastytradeHttpClient): Promise<{ items: unknown[] }> =>
  http.get("/watchlists");

export const getWatchlist = (http: TastytradeHttpClient, name: string): Promise<unknown> =>
  http.get(`/watchlists/${encodeURIComponent(name)}`);

export const createWatchlist = (
  http: TastytradeHttpClient,
  body: WatchlistBody,
): Promise<unknown> => http.post("/watchlists", body);

export const updateWatchlist = (
  http: TastytradeHttpClient,
  name: string,
  body: WatchlistBody,
): Promise<unknown> => http.put(`/watchlists/${encodeURIComponent(name)}`, body);

export const deleteWatchlist = (http: TastytradeHttpClient, name: string): Promise<unknown> =>
  http.delete(`/watchlists/${encodeURIComponent(name)}`);

export const listPublicWatchlists = (http: TastytradeHttpClient): Promise<{ items: unknown[] }> =>
  http.get("/public-watchlists");

export const getPublicWatchlist = (http: TastytradeHttpClient, name: string): Promise<unknown> =>
  http.get(`/public-watchlists/${encodeURIComponent(name)}`);
