import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { persistLocalSession } from "./local-results";

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function payload() {
  return {
    session: {
      sessionId: "agent_local_test_20260814T000000Z_12345678",
      observerType: "agent",
      startedAtUtc: "2026-08-14T00:00:00.000Z",
      randomSeed: 1,
    },
    results: [{ task: "visual_similarity", trialId: "4" }],
    trajectories: [{ trialId: "4", sampleIndex: 0, xRaw: 540, yRaw: 338 }],
  };
}

describe("local Vite results persistence", () => {
  it("writes separate response and trajectory JSON files using the existing layout", () => {
    const root = mkdtempSync(join(tmpdir(), "vibe-local-results-"));
    temporaryRoots.push(root);

    const files = persistLocalSession(payload(), root);

    expect(files).toEqual({
      responsePath: join(root, "response", "visual_similarity", "results_agent_local_test_20260814T000000Z_12345678.json"),
      trajectoryPath: join(root, "trajectory", "visual_similarity", "trajectories_agent_local_test_20260814T000000Z_12345678.json"),
    });
    expect(JSON.parse(readFileSync(files.responsePath, "utf8"))).toEqual({
      session: payload().session,
      results: payload().results,
    });
    expect(JSON.parse(readFileSync(files.trajectoryPath, "utf8"))).toEqual({
      session: payload().session,
      trajectories: payload().trajectories,
    });
  });

  it("rejects payloads without a safe session ID or known task", () => {
    const root = mkdtempSync(join(tmpdir(), "vibe-local-results-"));
    temporaryRoots.push(root);

    expect(() => persistLocalSession({ ...payload(), session: { ...payload().session, sessionId: "../unsafe" } }, root)).toThrow("safe session ID");
    expect(() => persistLocalSession({ ...payload(), results: [{ task: "unknown" }] }, root)).toThrow("known task");
  });
});
