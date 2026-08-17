import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileHandle } from "node:fs/promises";

export interface RunLogEvent {
  type: string;
  at: string;
  [key: string]: unknown;
}

export interface RunLoggerPort {
  log(event: RunLogEvent): Promise<void>;
  writeScreenshot(screenshotId: string, bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface RunLoggerOptions {
  root: string;
  runId: string;
  sensitiveValues?: readonly string[];
}

const sensitiveKey = /authorization|access.?token|refresh.?token|private.?key|client.?secret|password/i;

function redact(value: unknown, sensitiveValues: readonly string[], key?: string): unknown {
  if (key && sensitiveKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return sensitiveValues.reduce((result, sensitive) => (
      sensitive ? result.replaceAll(sensitive, "[REDACTED]") : result
    ), value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"));
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry, sensitiveValues));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redact(entryValue, sensitiveValues, entryKey),
    ]));
  }
  return value;
}

export class RunLogger implements RunLoggerPort {
  private closed = false;

  private constructor(
    private readonly eventFile: FileHandle,
    private readonly screenshotRoot: string,
    private readonly sensitiveValues: readonly string[],
  ) {}

  static async open(options: RunLoggerOptions): Promise<RunLogger> {
    if (!/^[A-Za-z0-9_-]+$/.test(options.runId)) throw new Error("runId contains unsupported characters");
    const runRoot = join(options.root, options.runId);
    const screenshotRoot = join(runRoot, "screenshots");
    await mkdir(screenshotRoot, { recursive: true, mode: 0o700 });
    const eventFile = await open(join(runRoot, "events.jsonl"), "a", 0o600);
    return new RunLogger(eventFile, screenshotRoot, options.sensitiveValues ?? []);
  }

  async log(event: RunLogEvent): Promise<void> {
    this.assertOpen();
    await this.eventFile.appendFile(`${JSON.stringify(redact(event, this.sensitiveValues))}\n`, "utf8");
  }

  async writeScreenshot(screenshotId: string, bytes: Uint8Array): Promise<void> {
    this.assertOpen();
    if (!/^[A-Za-z0-9_-]+$/.test(screenshotId)) throw new Error("screenshotId contains unsupported characters");
    await writeFile(join(this.screenshotRoot, `${screenshotId}.jpg`), bytes, { mode: 0o600 });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.eventFile.close();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Run logger is closed");
  }
}
