import { describe, expect, it } from "vitest";
import { validateSessionPayload } from "../src/validation";

const basePayload = () => ({
  session: {
    sessionId: "agent_openai_codex_20260816T000000Z_a1b2c3d4",
    observerType: "agent",
    startedAtUtc: "2026-08-16T00:00:00.000Z",
    randomSeed: 1,
  },
  results: [{ task: "object_matching", trialId: "1", selectedLabel: 2 }],
  trajectories: [{ trialId: "1", points: [[0, 0, 0], [16, 2, 3]] }],
});

describe("Firestore session payload validation", () => {
  it("accepts a valid session payload and counts bounded writes", () => {
    const validated = validateSessionPayload(basePayload(), "agent_openai_codex_20260816T000000Z_a1b2c3d4");

    expect(validated.writeCount).toBe(3);
    expect(validated.session.sessionId).toContain("agent_openai_codex");
  });

  it("rejects a mismatched idempotency key", () => {
    expect(() => validateSessionPayload(basePayload(), "different-session")).toThrow("Idempotency-Key");
  });

  it("rejects unknown task names and malformed trajectory points", () => {
    expect(() => validateSessionPayload({ ...basePayload(), results: [{ task: "secret_task", trialId: "1" }] }, "agent_openai_codex_20260816T000000Z_a1b2c3d4"))
      .toThrow("known task");
    expect(() => validateSessionPayload({ ...basePayload(), trajectories: [{ trialId: "1", points: [[0, 0]] }] }, "agent_openai_codex_20260816T000000Z_a1b2c3d4"))
      .toThrow("trajectory point");
  });
});
