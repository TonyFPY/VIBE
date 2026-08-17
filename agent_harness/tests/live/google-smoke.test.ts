import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { PlaywrightBrowserHost } from "../../src/browser/playwright-controller";
import { parseHarnessConfig } from "../../src/config/load-config";
import { resolveModelSpec } from "../../src/config/model-catalog";
import { RunLoop } from "../../src/core/run-loop";
import { RunLogger } from "../../src/logging/run-logger";
import { publicInstructionForTask } from "../../src/prompts/public-instruction";
import { GoogleAgentPlatformAdapter } from "../../src/providers/google-agent-platform";

it("performs at least one public action through a real Google vision model", async () => {
  if (process.env.RUN_GOOGLE_SMOKE !== "1") throw new Error("RUN_GOOGLE_SMOKE=1 is required");
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const taskUrl = process.env.AGENT_TASK_URL?.trim();
  const modelId = process.env.AGENT_MODEL?.trim();
  const location = process.env.GOOGLE_CLOUD_LOCATION?.trim() || "global";
  if (!project || !taskUrl || !modelId) {
    throw new Error("GOOGLE_CLOUD_PROJECT, AGENT_TASK_URL, and AGENT_MODEL are required");
  }

  const config = parseHarnessConfig({
    taskUrl,
    participantId: process.env.AGENT_PARTICIPANT_ID?.trim() || "001",
    model: modelId,
    location,
    runMode: "dev",
    maxSteps: 10,
    maxInvalidActions: 3,
    performance: { totalRunTimeoutMs: 600_000 },
  });
  const temporaryRoot = await mkdtemp(join(tmpdir(), "agent-harness-live-"));
  const logger = await RunLogger.open({ root: temporaryRoot, runId: "google-smoke" });
  const browserHost = new PlaywrightBrowserHost({
    settleDelayMs: config.performance.settleDelayMs,
    navigationTimeoutMs: config.performance.connectTimeoutMs,
  });
  const adapter = new GoogleAgentPlatformAdapter({
    project,
    location,
    model: resolveModelSpec(modelId, location),
    performance: config.performance,
  });

  try {
    const summary = await new RunLoop({ browserHost, model: adapter, logger }).run(
      config,
      publicInstructionForTask(taskUrl),
    );
    expect(summary.actionCount).toBeGreaterThan(0);
    expect(summary.status).not.toBe("failed");
  } finally {
    await browserHost.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
