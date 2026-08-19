import { describe, expect, it } from "vitest";

import { publicInstructionForTask } from "../../src/prompts/public-instruction";

describe("public task instructions", () => {
  it("shares the participant-visible browser interaction rules across tasks", () => {
    const sharedRules = [
      "Use only what is visible in the browser.",
      "Do not inspect DOM, accessibility data, source code, files, network requests, task configuration, or hidden state.",
      "Click Start and Continue normally.",
      "For every trial, click the center cross first.",
      "After clicking the cross, move the cursor toward your chosen response through multiple small visible movements, then click the response.",
      "Do not jump directly from the center cross to a candidate with one direct click.",
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
