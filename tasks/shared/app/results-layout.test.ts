import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("results layout documentation", () => {
  it("documents the response, trajectory, and figure result paths", () => {
    const readme = readFileSync("results/README.md", "utf8");

    expect(readme).toContain("response/<task>");
    expect(readme).toContain("trajectory/<task>");
    expect(readme).toContain("figure/<task>");
  });
});
