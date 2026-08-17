import { describe, expect, it } from "vitest";

import { TimingHistogram } from "../../src/metrics/timing";

describe("constant-memory timing histogram", () => {
  it("summarizes count, total, median, and p95 without retaining samples", () => {
    const timing = new TimingHistogram();
    [1, 2, 3, 100].forEach((milliseconds) => timing.observe(milliseconds));
    expect(timing.summary()).toEqual({
      count: 4,
      totalMs: 106,
      medianUpperBoundMs: 2,
      p95UpperBoundMs: 100,
    });
    expect(Object.keys(timing)).toEqual(["counts", "count", "totalMs"]);
  });
});
