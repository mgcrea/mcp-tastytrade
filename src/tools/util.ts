import { TastytradeApiError } from "../client/errors.js";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

export const fail = (message: string, extra?: unknown): ToolResult => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({ error: message, ...(extra ? { details: extra } : {}) }, null, 2),
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
