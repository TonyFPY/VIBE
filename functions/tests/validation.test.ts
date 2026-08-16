import { describe, expect, it } from "vitest";
import { normalizeTrajectoryForFirestore, validateSessionPayload } from "../src/validation";

const basePayload = () => ({
  session: {
    sessionId: "dev_agent_001_20260816T000000Z_a1b2c3d4",
    participantId: "001",
    participantType: "agent",
    model: "gpt-5.6-luna",
    runMode: "dev",
  },
  results: [{ task: "object_matching", trialId: "1", selectedLabel: 2 }],
  trajectories: [{ trialId: "1", points: [[0, 0, 0], [16, 2, 3]] }],
});

describe("Firestore session payload validation", () => {
  it("converts nested trajectory tuples to Firestore-safe point maps", () => {
    const trajectory = {
      trialId: "1",
      points: [[0, 100, 200], [16, 120, 180]],
    };

    expect(normalizeTrajectoryForFirestore(trajectory)).toEqual({
      trialId: "1",
      points: [
        {elapsedMs: 0, xPx: 100, yPx: 200},
        {elapsedMs: 16, xPx: 120, yPx: 180},
      ],
    });
    expect(trajectory.points).toEqual([[0, 100, 200], [16, 120, 180]]);
  });

  it("accepts a valid session payload and counts bounded writes", () => {
    const validated = validateSessionPayload(basePayload(), "dev_agent_001_20260816T000000Z_a1b2c3d4");

    expect(validated.writeCount).toBe(3);
    expect(validated.session).toEqual(basePayload().session);
  });

  it("rejects a mismatched idempotency key", () => {
    expect(() => validateSessionPayload(basePayload(), "different-session")).toThrow("Idempotency-Key");
  });

  it("rejects unknown task names and malformed trajectory points", () => {
    expect(() => validateSessionPayload({ ...basePayload(), results: [{ task: "secret_task", trialId: "1" }] }, "dev_agent_001_20260816T000000Z_a1b2c3d4"))
      .toThrow("known task");
    expect(() => validateSessionPayload({ ...basePayload(), trajectories: [{ trialId: "1", points: [[0, 0]] }] }, "dev_agent_001_20260816T000000Z_a1b2c3d4"))
      .toThrow("trajectory point");
  });
});
