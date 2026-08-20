import { describe, expect, it } from "vitest";

import { shuffleTestingPhase } from "./randomization";

describe("testing-phase randomization", () => {
  it("keeps training unchanged and deterministically shuffles only testing", () => {
    const phases = {
      training: ["training-0", "training-1", "training-2"],
      testing: Array.from({ length: 12 }, (_, index) => `testing-${index}`),
    };

    const first = shuffleTestingPhase(phases, "session-001");
    const repeated = shuffleTestingPhase(phases, "session-001");
    const otherSession = shuffleTestingPhase(phases, "session-002");

    expect(first.training).toEqual(phases.training);
    expect(first.testing).toHaveLength(phases.testing.length);
    expect(first.testing).toEqual(repeated.testing);
    expect(first.testing).not.toEqual(phases.testing);
    expect(otherSession.testing).not.toEqual(first.testing);
    expect(new Set(first.testing)).toEqual(new Set(phases.testing));
  });

  it("does not mutate either input phase", () => {
    const phases = {
      training: ["training-0", "training-1", "training-2"],
      testing: ["testing-0", "testing-1", "testing-2"],
    };
    const original = structuredClone(phases);

    const shuffled = shuffleTestingPhase(phases, "session-001");

    expect(phases).toEqual(original);
    expect(shuffled.training).not.toBe(phases.training);
    expect(shuffled.testing).not.toBe(phases.testing);
  });
});
