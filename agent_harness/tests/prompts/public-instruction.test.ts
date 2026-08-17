import { describe, expect, it } from "vitest";

import { publicInstructionForTask } from "../../src/prompts/public-instruction";

describe("public task instructions", () => {
  it("returns only participant-visible guidance for supported routes", () => {
    expect(publicInstructionForTask("https://example.test/tasks/visual-similarity?model=secret")).toBe(
      "Complete the visual similarity experiment using only what is visible. Start or continue when prompted. Choose the candidate most visually similar to the reference after each trial is revealed. Return DONE only when the visible page says the experiment is complete or results were saved successfully; do not finish while it still says results are saving.",
    );
    expect(publicInstructionForTask("https://example.test/tasks/object-matching")).toContain(
      "Choose the candidate object that belongs with the reference",
    );
  });

  it("rejects unsupported task routes", () => {
    expect(() => publicInstructionForTask("https://example.test/admin")).toThrow("Unsupported task route");
  });
});
