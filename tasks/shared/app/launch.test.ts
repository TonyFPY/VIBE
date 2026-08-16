import { describe, expect, it } from "vitest";
import { parseLaunch, runModeFromSearch } from "./launch";

describe("launch parsing", () => {
  it("selects visual similarity and defaults to the development run", () => {
    expect(parseLaunch("/tasks/visual-similarity", "")).toEqual({
      task: "visual-similarity", runMode: "development",
    });
  });

  it("selects object matching and canonical development mode from run=dev", () => {
    expect(parseLaunch("/tasks/object-matching", "?run=dev")).toEqual({
      task: "object-matching", runMode: "development",
    });
  });

  it("selects the operation mode from run=ops", () => {
    expect(parseLaunch("/tasks/object-matching", "?run=ops")).toEqual({
      task: "object-matching", runMode: "full",
    });
  });

  it("accepts the legacy development selector", () => {
    expect(runModeFromSearch("?mode=development")).toBe("development");
  });

  it("treats unknown modes as development", () => {
    expect(runModeFromSearch("?run=preview")).toBe("development");
  });

  it("rejects undeclared task routes", () => {
    expect(() => parseLaunch("/tasks/not-a-task", "")).toThrow("Unknown task route");
  });
});
