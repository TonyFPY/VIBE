#!/usr/bin/env node

import { appendFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { formatCodexEvent, formatTerminalText } from "./format-codex-event.mjs";

export const NON_JSON_LINE_LIMIT = 320;
const BASE64_PAYLOAD_PATTERN = /\b[A-Za-z0-9+/]{96,}={0,2}\b/g;
const DATA_URI_PATTERN = /data:[^,\s]+;base64,[A-Za-z0-9+/=._-]+/gi;
const DATA_FIELD_PATTERN = /\bdata\s*[:=]\s*(?:[A-Za-z0-9+/]{32,}={0,2}|data:[^,\s]+;base64,[A-Za-z0-9+/=._-]+)/i;

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
    if (DATA_FIELD_PATTERN.test(line)) {
      return formatTerminalText("payload-like output omitted", context);
    }
    let sanitized = line
      .replace(DATA_URI_PATTERN, "[omitted data-uri payload]")
      .replace(BASE64_PAYLOAD_PATTERN, "[omitted base64 payload]");
    const clipped = sanitized.length > NON_JSON_LINE_LIMIT
      ? `${sanitized.slice(0, NON_JSON_LINE_LIMIT).trimEnd()}…`
      : sanitized;
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
