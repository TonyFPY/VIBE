import { describe, expect, it } from "vitest";

import { publicInstructionForTask } from "../../src/prompts/public-instruction";

describe("public task instructions", () => {
  it("shares the participant-visible browser interaction rules across tasks", () => {
    const sharedRules = [
      "Use only what is visible in the browser.",
      "Do not inspect DOM, accessibility data, source code, files, network requests, task configuration, or hidden state.",
      "Click Start and Continue normally.",
      "For every trial, the visible fixation marker must be clicked first; wait until it is visibly present before responding.",
      "When the fixation marker is visible, use the fixation-marker step once.",
      "After the fixation screenshot shows the stimuli, submit the response actions.",
      "The middle image labeled “reference” is not a response target; on response screens click only one of the surrounding candidate tiles.",
      "If “Preparing trial…” or another loading message is visible, wait instead of submitting response actions.",
      "After clicking the fixation marker, provide a dense visible pointer trajectory toward your chosen response; the final trajectory point is clicked as the response.",
      "If “Save incomplete” appears, click `Download results`, then `Download trajectories`, and stop.",
      "If “Results saved successfully” appears, do not click a download button: the API already saved both files. Stop.",
    ];

    for (const taskPath of ["visual-similarity", "object-matching"]) {
      const instruction = publicInstructionForTask(`https://example.test/tasks/${taskPath}`);
      for (const rule of sharedRules) expect(instruction).toContain(rule);
    }
  });

  it("does not echo query values or evaluator implementation details", () => {
    const instruction = publicInstructionForTask(
      "https://example.test/tasks/visual-similarity?model=SECRET_ANSWER_CANARY",
    );

    expect(instruction).not.toContain("SECRET_ANSWER_CANARY");
    expect(instruction).not.toContain("Playwright");
    expect(instruction).not.toContain("participantId");
  });

  it("rejects unsupported task routes", () => {
    expect(() => publicInstructionForTask("https://example.test/admin")).toThrow("Unsupported task route");
  });
});
