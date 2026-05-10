const camelToKebab = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();

const kebabToCamel = (key: string): string =>
  key.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

const transformKeys = (value: unknown, fn: (key: string) => string): unknown => {
  if (Array.isArray(value)) {
    return value.map((v) => transformKeys(v, fn));
  }
  if (value !== null && typeof value === "object" && (value as object).constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[fn(k)] = transformKeys(v, fn);
    }
    return out;
  }
  return value;
};

export const toKebabKeys = (value: unknown): unknown => transformKeys(value, camelToKebab);
export const toCamelKeys = (value: unknown): unknown => transformKeys(value, kebabToCamel);
