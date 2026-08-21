import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { filterCodexOutput, formatCodexLine } from "./filter-codex-output.mjs";

test("formats readable model text and unknown events for terminal output", () => {
  assert.equal(
    formatCodexLine(
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: " Trial 1:\n\n  left image matches.  ",
        },
      }),
      { runId: "A46", attempt: 2 },
    ),
    "[A46 attempt 2] Trial 1: left image matches.",
  );

  assert.equal(
    formatCodexLine(JSON.stringify({ type: "mystery.event", data: "hidden" }), { runId: "A46", attempt: 2 }),
    "[A46 attempt 2] event mystery.event",
  );
});

test("normalizes non-json output and truncates it for terminal display", () => {
  const line = `codex diagnostic ${"x".repeat(500)}`;
  const formatted = formatCodexLine(line, { runId: "A46", attempt: 2 });
  assert.match(formatted, /^\[A46 attempt 2\] codex diagnostic x+/);
  assert.ok(formatted.endsWith("…"));
  assert.ok(formatted.length < 360);
});

test("writes raw jsonl separately while printing only filtered text", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-filter-"));
  const rawLogPath = path.join(root, "raw.jsonl");
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on("data", (chunk) => chunks.push(String(chunk)));

  input.end(`${JSON.stringify({
    type: "item.completed",
    item: {
      type: "mcp_tool_call",
      id: "item_9",
      server: "vibe_browser",
      tool: "wait",
      arguments: { milliseconds: 250 },
      result: {
        content: [
          { type: "image", mimeType: "image/jpeg", data: "x".repeat(2048) },
          { type: "text", text: "Screenshot captured" },
        ],
      },
      status: "completed",
    },
  })}\n`);

  await filterCodexOutput(input, output, { runId: "A46", attempt: 2, rawLogPath });

  assert.equal(chunks.join(""), "[A46 attempt 2] tool wait completed after 250ms; screenshot updated\n");

  const rawLog = await readFile(rawLogPath, "utf8");
  assert.match(rawLog, /"type":"item\.completed"/);
  assert.match(rawLog, /"data":"x{100}/);
});
