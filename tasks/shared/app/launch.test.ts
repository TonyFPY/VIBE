import { describe, expect, it } from "vitest";
import { parseLaunch, runModeFromSearch } from "./launch";

describe("launch parsing", () => {
  it("selects visual similarity and defaults to the full run", () => {
    expect(parseLaunch("/tasks/visual-similarity", "")).toEqual({
      task: "visual-similarity", runMode: "full",
    });
  });

  it("selects object matching and canonical development mode", () => {
    expect(parseLaunch("/tasks/object-matching", "?run=development")).toEqual({
      task: "object-matching", runMode: "development",
    });
  });

  it("accepts the legacy development selector", () => {
    expect(runModeFromSearch("?mode=development")).toBe("development");
  });

  it("keeps trace smoke explicit and treats other values as full", () => {
    expect(runModeFromSearch("?run=trace-smoke")).toBe("trace-smoke");
    expect(runModeFromSearch("?run=preview")).toBe("full");
  });

  it("rejects undeclared task routes", () => {
    expect(() => parseLaunch("/tasks/not-a-task", "")).toThrow("Unknown task route");
  });
});
