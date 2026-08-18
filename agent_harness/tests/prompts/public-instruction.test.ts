import { describe, expect, it } from "vitest";

import { publicInstructionForTask } from "../../src/prompts/public-instruction";

describe("public task instructions", () => {
  it("returns only participant-visible guidance for supported routes", () => {
    expect(publicInstructionForTask("https://example.test/tasks/visual-similarity?model=secret")).toBe(
      "Complete the visual similarity experiment using only what is visible on the screen. Start or continue when the page prompts you. After each trial is revealed, choose the visible candidate most visually similar to the reference. Keep acting until the page visibly reaches the saved or successfully completed state.",
    );
    expect(publicInstructionForTask("https://example.test/tasks/object-matching")).toContain(
      "choose the visible candidate object that belongs with the reference",
    );
  });

  it("rejects unsupported task routes", () => {
    expect(() => publicInstructionForTask("https://example.test/admin")).toThrow("Unsupported task route");
  });
});
