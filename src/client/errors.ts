export class TastytradeApiError extends Error {
  override readonly name = "TastytradeApiError";
  readonly status: number;
  readonly code: string | undefined;
  readonly body: unknown;

  constructor(message: string, opts: { status: number; code?: string; body?: unknown }) {
    super(message);
    this.status = opts.status;
    this.code = opts.code;
    this.body = opts.body;
  }
}
