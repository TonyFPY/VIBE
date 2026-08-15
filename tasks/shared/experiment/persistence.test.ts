import { describe, expect, it } from "vitest";
import { resultsEndpoint } from "./persistence";

describe("results endpoint", () => {
  it("uses the same-origin API by default", () => {
    expect(resultsEndpoint({})).toBe("/api/experiments/sessions");
  });

  it("uses a configured endpoint for a separately deployed API", () => {
    expect(resultsEndpoint({ VITE_RESULTS_ENDPOINT: "https://api.example.test/sessions" }))
      .toBe("https://api.example.test/sessions");
  });

  it("ignores an empty configured endpoint", () => {
    expect(resultsEndpoint({ VITE_RESULTS_ENDPOINT: "" })).toBe("/api/experiments/sessions");
  });
});
