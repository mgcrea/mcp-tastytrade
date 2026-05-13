import type { TastytradeHttpClient } from "../http.js";

// REST `/market-data/by-type` row. Field names match what the HTTP client
// produces after toCamelKeys() — `bid-size` → `bidSize`, `updated-at` → `updatedAt`.
export type MarketDataRow = {
  symbol: string;
  instrumentType?: string;
  bid?: number | string | null;
  ask?: number | string | null;
  mark?: number | string | null;
  last?: number | string | null;
  bidSize?: number | string | null;
  askSize?: number | string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
};

export type MarketDataByTypeRequest = {
  equities?: string[];
  equityOptions?: string[];
  futures?: string[];
  futureOptions?: string[];
  cryptocurrencies?: string[];
  indices?: string[];
};

// Tastytrade caps `/market-data/by-type` at 100 symbols across all types per call.
const BATCH_LIMIT = 100;

// The HTTP client's buildQuery serializes string[] as `key[]=v1&key[]=v2`, but
// Tastytrade's /market-data/by-type expects comma-joined values: `equity=AAPL,SPY`.
// Pass pre-joined strings to bypass that array path.
const joinOrUndef = (xs: string[] | undefined): string | undefined =>
  xs && xs.length > 0 ? xs.join(",") : undefined;

// Split a multi-bucket request into batches of at most BATCH_LIMIT total symbols.
// Each batch is its own GET to keep the total within the API cap.
const buildBatches = (req: MarketDataByTypeRequest): MarketDataByTypeRequest[] => {
  const total =
    (req.equities?.length ?? 0) +
    (req.equityOptions?.length ?? 0) +
    (req.futures?.length ?? 0) +
    (req.futureOptions?.length ?? 0) +
    (req.cryptocurrencies?.length ?? 0) +
    (req.indices?.length ?? 0);
  if (total === 0) return [];
  if (total <= BATCH_LIMIT) return [req];

  // Greedy bucket-packing: fill each batch up to the cap from each type in turn.
  const buckets: [keyof MarketDataByTypeRequest, string[]][] = [
    ["equities", [...(req.equities ?? [])]],
    ["equityOptions", [...(req.equityOptions ?? [])]],
    ["futures", [...(req.futures ?? [])]],
    ["futureOptions", [...(req.futureOptions ?? [])]],
    ["cryptocurrencies", [...(req.cryptocurrencies ?? [])]],
    ["indices", [...(req.indices ?? [])]],
  ];
  const batches: MarketDataByTypeRequest[] = [];
  while (buckets.some(([, arr]) => arr.length > 0)) {
    const batch: MarketDataByTypeRequest = {};
    let remaining = BATCH_LIMIT;
    for (const [key, arr] of buckets) {
      if (remaining === 0) break;
      if (arr.length === 0) continue;
      const take = arr.splice(0, Math.min(remaining, arr.length));
      batch[key] = take;
      remaining -= take.length;
    }
    batches.push(batch);
  }
  return batches;
};

// Build the query string manually with encodeURIComponent (which encodes spaces
// as %20). URLSearchParams uses `+` for spaces, which some strict servers reject
// in option symbols like "IWM   260529C00300000".
const buildByTypeQuery = (batch: MarketDataByTypeRequest): string => {
  const parts: string[] = [];
  const push = (key: string, values: string[] | undefined): void => {
    const joined = joinOrUndef(values);
    if (joined !== undefined) parts.push(`${key}=${encodeURIComponent(joined)}`);
  };
  push("equity", batch.equities);
  push("equity-option", batch.equityOptions);
  push("future", batch.futures);
  push("future-option", batch.futureOptions);
  push("cryptocurrency", batch.cryptocurrencies);
  push("index", batch.indices);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
};

export const getMarketDataByType = async (
  http: TastytradeHttpClient,
  req: MarketDataByTypeRequest,
  opts: { signal?: AbortSignal } = {},
): Promise<MarketDataRow[]> => {
  const batches = buildBatches(req);
  if (batches.length === 0) return [];

  const responses = await Promise.all(
    batches.map((batch) =>
      http.get<{ items?: MarketDataRow[] }>(
        `/market-data/by-type${buildByTypeQuery(batch)}`,
        opts.signal ? { signal: opts.signal } : {},
      ),
    ),
  );

  const items: MarketDataRow[] = [];
  for (const res of responses) {
    for (const row of res.items ?? []) items.push(row);
  }
  return items;
};
