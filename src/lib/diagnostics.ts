// In-memory ring buffer for recent log lines. Tee'd from the stderr logger
// so the get_diagnostics tool can surface what would otherwise scroll past
// in the MCP host's server-log panel.

export type LogLevel = "debug" | "warn" | "error";

export type LogEntry = {
  ts: string;
  level: LogLevel;
  message: string;
};

const formatArg = (a: unknown): string => {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.message;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
};

export class DiagnosticsRecorder {
  private readonly buffer: LogEntry[] = [];

  constructor(
    private readonly capacity: number = 200,
    private readonly now: () => Date = () => new Date(),
  ) {}

  log(level: LogLevel, args: unknown[]): void {
    this.buffer.push({
      ts: this.now().toISOString(),
      level,
      message: args.map(formatArg).join(" "),
    });
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
  }

  recent(limit?: number): LogEntry[] {
    if (limit === undefined) return [...this.buffer];
    if (limit <= 0) return [];
    if (limit >= this.buffer.length) return [...this.buffer];
    return this.buffer.slice(-limit);
  }

  size(): number {
    return this.buffer.length;
  }
}
