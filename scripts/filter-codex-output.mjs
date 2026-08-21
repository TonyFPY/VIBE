#!/usr/bin/env node

import { appendFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { formatCodexEvent, formatTerminalText } from "./format-codex-event.mjs";

export const NON_JSON_LINE_LIMIT = 320;

function buildContext(overrides = {}) {
  return {
    runId: overrides.runId ?? process.env.CODEX_RUN_ID ?? "run",
    attempt: Number.parseInt(
      String(overrides.attempt ?? process.env.CODEX_ATTEMPT ?? "1"),
      10,
    ) || 1,
    rawLogPath: overrides.rawLogPath ?? process.env.CODEX_RAW_LOG_PATH,
  };
}

export function formatCodexLine(line, overrides = {}) {
  const context = buildContext(overrides);
  try {
    return formatCodexEvent(JSON.parse(line), context);
  } catch {
    const clipped = line.length > NON_JSON_LINE_LIMIT
      ? `${line.slice(0, NON_JSON_LINE_LIMIT).trimEnd()}…`
      : line;
    return formatTerminalText(clipped, context);
  }
}

export async function filterCodexOutput(input, output, overrides = {}) {
  const context = buildContext(overrides);
  const reader = createInterface({ input, crlfDelay: Infinity });
  for await (const line of reader) {
    if (context.rawLogPath) await appendFile(context.rawLogPath, `${line}\n`);
    const formatted = formatCodexLine(line, context);
    if (formatted) output.write(`${formatted}\n`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  await filterCodexOutput(process.stdin, process.stdout);
}
