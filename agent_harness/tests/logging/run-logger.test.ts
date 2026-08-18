import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RunLogger } from "../../src/logging/run-logger";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RunLogger", () => {
  it("streams redacted JSONL events and JPEG bytes to a private run directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-harness-log-"));
    temporaryRoots.push(root);
    const logger = await RunLogger.open({ root, runId: "run-001", sensitiveValues: ["token-value"] });

    await logger.log({
      type: "model-response",
      at: "2026-08-16T20:00:00.000Z",
      authorization: "Bearer token-value",
      accessToken: "token-value",
      rawOutput: {
        id: "interaction-001",
        steps: [{ type: "function_call", id: "call-001", name: "click", arguments: { x: 700, y: 500 } }],
      },
    });
    await logger.writeScreenshot("shot-001", Uint8Array.from([0xff, 0xd8, 0xff]));
    await logger.close();

    const eventText = await readFile(join(root, "run-001", "events.jsonl"), "utf8");
    expect(eventText).toContain('"rawOutput":{"id":"interaction-001","steps":[{"type":"function_call"');
    expect(eventText).not.toContain("token-value");
    expect(eventText).toContain('"authorization":"[REDACTED]"');
    await expect(readFile(join(root, "run-001", "screenshots", "shot-001.jpg"))).resolves.toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });
});
