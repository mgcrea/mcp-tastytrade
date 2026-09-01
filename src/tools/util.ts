import { TastytradeApiError } from "#/client/errors";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/**
 * Compact, not pretty-printed. `null, 2` adds 19-41% to every response — worst
 * on wide lists of short-keyed objects, which are exactly the replies already
 * big enough to hurt. No model needs the indentation, and every tool returns
 * through here. Files written to disk for humans stay pretty.
 */
export const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
});

export const fail = (message: string, extra?: unknown): ToolResult => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({ error: message, ...(extra ? { details: extra } : {}) }),
    },
  ],
  isError: true,
});

export const wrap = async <T>(fn: () => Promise<T>): Promise<ToolResult> => {
  try {
    const value = await fn();
    return ok(value);
  } catch (err) {
    if (err instanceof TastytradeApiError) {
      return fail(err.message, { status: err.status, code: err.code, body: err.body });
    }
    if (err instanceof Error) {
      return fail(err.message);
    }
    return fail("Unknown error", err);
  }
};
