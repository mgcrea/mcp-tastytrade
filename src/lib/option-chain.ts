// Slicing helpers for the nested option-chain response from TastyTrade.
// The API returns the full chain (often 200–800 KB) — these helpers turn that
// raw payload into either a slim summary or a filtered slice for use by tools.

export type RawChainStrike = {
  strikePrice: string;
  call: string;
  callStreamerSymbol: string;
  put: string;
  putStreamerSymbol: string;
};

export type RawChainExpiration = {
  expirationType?: string;
  expirationDate: string;
  daysToExpiration: number;
  settlementType?: string;
  strikes: RawChainStrike[];
};

export type RawChainRoot = {
  underlyingSymbol: string;
  rootSymbol?: string;
  optionChainType?: string;
  sharesPerContract?: number;
  expirations: RawChainExpiration[];
};

export type ChainSummary = {
  underlyingSymbol: string;
  rootSymbol: string | undefined;
  optionChainType: string | undefined;
  sharesPerContract: number | undefined;
  expirations: {
    expirationDate: string;
    daysToExpiration: number;
    expirationType: string | undefined;
    strikeCount: number;
    minStrike: number | null;
    maxStrike: number | null;
  }[];
};

export type ChainLeg = {
  expirationDate: string;
  daysToExpiration: number;
  strikePrice: number;
  optionType: "Call" | "Put";
  occ: string;
  streamerSymbol: string;
};

export type ChainSlice = {
  underlyingSymbol: string;
  rootSymbol: string | undefined;
  sharesPerContract: number | undefined;
  legs: ChainLeg[];
};

export type ChainFilter = {
  expirationDate?: string;
  daysToExpirationMin?: number;
  daysToExpirationMax?: number;
  strikeMin?: number;
  strikeMax?: number;
  strikeAround?: { center: number; count: number };
  optionType?: "call" | "put" | "both";
};

const num = (s: string): number => Number(s);

export const isFilterEmpty = (filter: ChainFilter): boolean => {
  return (
    filter.expirationDate === undefined &&
    filter.daysToExpirationMin === undefined &&
    filter.daysToExpirationMax === undefined &&
    filter.strikeMin === undefined &&
    filter.strikeMax === undefined &&
    filter.strikeAround === undefined &&
    filter.optionType === undefined
  );
};

export const summarizeChain = (root: RawChainRoot): ChainSummary => ({
  underlyingSymbol: root.underlyingSymbol,
  rootSymbol: root.rootSymbol,
  optionChainType: root.optionChainType,
  sharesPerContract: root.sharesPerContract,
  expirations: (root.expirations ?? []).map((ex) => {
    const strikes = ex.strikes ?? [];
    const prices = strikes.map((s) => num(s.strikePrice)).filter((n) => Number.isFinite(n));
    return {
      expirationDate: ex.expirationDate,
      daysToExpiration: ex.daysToExpiration,
      expirationType: ex.expirationType,
      strikeCount: strikes.length,
      minStrike: prices.length > 0 ? Math.min(...prices) : null,
      maxStrike: prices.length > 0 ? Math.max(...prices) : null,
    };
  }),
});

export const sliceChain = (root: RawChainRoot, filter: ChainFilter): ChainSlice => {
  const optionType = filter.optionType ?? "both";
  const wantCall = optionType !== "put";
  const wantPut = optionType !== "call";

  const expirations = (root.expirations ?? []).filter((ex) => {
    if (filter.expirationDate && ex.expirationDate !== filter.expirationDate) return false;
    if (
      filter.daysToExpirationMin !== undefined &&
      ex.daysToExpiration < filter.daysToExpirationMin
    )
      return false;
    if (
      filter.daysToExpirationMax !== undefined &&
      ex.daysToExpiration > filter.daysToExpirationMax
    )
      return false;
    return true;
  });

  const legs: ChainLeg[] = [];
  for (const ex of expirations) {
    let strikes = (ex.strikes ?? []).filter((s) => Number.isFinite(num(s.strikePrice)));
    if (filter.strikeMin !== undefined)
      strikes = strikes.filter((s) => num(s.strikePrice) >= filter.strikeMin!);
    if (filter.strikeMax !== undefined)
      strikes = strikes.filter((s) => num(s.strikePrice) <= filter.strikeMax!);
    if (filter.strikeAround) {
      const { center, count } = filter.strikeAround;
      strikes = strikes
        .toSorted(
          (a, b) => Math.abs(num(a.strikePrice) - center) - Math.abs(num(b.strikePrice) - center),
        )
        .slice(0, count)
        .toSorted((a, b) => num(a.strikePrice) - num(b.strikePrice));
    }
    for (const s of strikes) {
      const strikePrice = num(s.strikePrice);
      if (wantCall) {
        legs.push({
          expirationDate: ex.expirationDate,
          daysToExpiration: ex.daysToExpiration,
          strikePrice,
          optionType: "Call",
          occ: s.call,
          streamerSymbol: s.callStreamerSymbol,
        });
      }
      if (wantPut) {
        legs.push({
          expirationDate: ex.expirationDate,
          daysToExpiration: ex.daysToExpiration,
          strikePrice,
          optionType: "Put",
          occ: s.put,
          streamerSymbol: s.putStreamerSymbol,
        });
      }
    }
  }

  return {
    underlyingSymbol: root.underlyingSymbol,
    rootSymbol: root.rootSymbol,
    sharesPerContract: root.sharesPerContract,
    legs,
  };
};
