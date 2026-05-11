// TastyTrade exposes option symbols in two formats:
//   OCC:    "IWM   260529C00300000"  (root padded to 6 chars, YYMMDD, C/P, strike × 1000 padded to 8 digits)
//   DXLink: ".IWM260529C300"          (dot prefix, no padding, decimal strike, optional fractional part)
// The TT API uses OCC; the streaming feed uses DXLink.

const OCC_RE = /^([A-Z][A-Z0-9.$/]{0,5})\s+(\d{6})([CP])(\d{8})$/;

export const isDxlinkOption = (sym: string): boolean => sym.startsWith(".");

export const isOccOption = (sym: string): boolean => OCC_RE.test(sym);

export const isOption = (sym: string): boolean => isDxlinkOption(sym) || isOccOption(sym);

const stripTrailingZeros = (n: number): string => {
  // Avoid scientific notation; preserve fractional part for strikes like 287.5
  const s = n.toString();
  return s;
};

export const occToDxlink = (occ: string): string => {
  const match = OCC_RE.exec(occ);
  if (!match) {
    throw new Error(`Not an OCC option symbol: "${occ}"`);
  }
  const [, root, yymmdd, cp, strikeRaw] = match;
  const strikeNum = Number(strikeRaw) / 1000;
  return `.${root}${yymmdd}${cp}${stripTrailingZeros(strikeNum)}`;
};

export const toDxlink = (sym: string): string => {
  if (isOccOption(sym)) return occToDxlink(sym);
  return sym;
};
