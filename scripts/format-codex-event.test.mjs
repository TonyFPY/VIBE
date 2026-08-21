import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatCodexEvent,
  formatModelMessage,
  summarizeToolEvent,
} from "./format-codex-event.mjs";

test("formats model messages with prefixes and normalized whitespace", () => {
  assert.equal(
    formatModelMessage("  Trial 2:\n\n  top image is correct.  ", { runId: "A48", attempt: 3 }),
    "[A48 attempt 3] Trial 2: top image is correct.",
  );
});

test("truncates long model text", () => {
  const formatted = formatModelMessage(`Result ${"ordinary prose ".repeat(40)}`, { runId: "A48", attempt: 3 });
  assert.ok(formatted.startsWith("[A48 attempt 3] Result "));
  assert.ok(formatted.endsWith("…"));
  assert.ok(formatted.length < 360);
});

test("summarizes tool start, coordinates, status, and screenshots without image payloads", () => {
  assert.equal(
    summarizeToolEvent(
      {
        type: "item.started",
        item: {
          id: "item_14",
          type: "mcp_tool_call",
          server: "vibe_browser",
          tool: "move",
          arguments: { x: 544, y: 260 },
          status: "in_progress",
        },
      },
      { runId: "A48", attempt: 3 },
    ),
    "[A48 attempt 3] tool move started at (544, 260)",
  );

  assert.equal(
    summarizeToolEvent(
      {
        type: "item.completed",
        item: {
          id: "item_15",
          type: "mcp_tool_call",
          server: "vibe_browser",
          tool: "observe",
          arguments: {},
          result: {
            content: [
              { type: "image", mimeType: "image/jpeg", data: "x".repeat(4096) },
            ],
          },
          status: "completed",
        },
      },
      { runId: "A48", attempt: 3 },
    ),
    "[A48 attempt 3] tool observe completed; screenshot updated",
  );
});

test("summarizes retries, errors, and final turn status", () => {
  assert.equal(
    summarizeToolEvent(
      {
        type: "item.completed",
        item: {
          id: "item_16",
          type: "mcp_tool_call",
          server: "vibe_browser",
          tool: "click",
          arguments: { x: 546, y: 343 },
          error: { message: "transport closed; retrying" },
          status: "failed",
        },
      },
      { runId: "A48", attempt: 3 },
    ),
    "[A48 attempt 3] tool click failed at (546, 343): transport closed; retrying",
  );

  assert.equal(
    formatCodexEvent(
      {
        type: "turn.completed",
        usage: {
          input_tokens: 1234,
          cached_input_tokens: 1200,
          output_tokens: 45,
          reasoning_output_tokens: 7,
        },
      },
      { runId: "A48", attempt: 3 },
    ),
    "[A48 attempt 3] turn completed; tokens in=1234 cached=1200 out=45 reasoning=7",
  );
});

test("omits generic data payloads and falls back on unknown json events", () => {
  assert.equal(
    formatCodexEvent(
      {
        type: "backend-event",
        data: { secret: "omit-me" },
      },
      { runId: "A48", attempt: 3 },
    ),
    "[A48 attempt 3] event backend-event",
  );
});
