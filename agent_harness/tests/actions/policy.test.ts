import { describe, expect, it } from "vitest";

import { validateActionBounds } from "../../src/actions/policy";

const viewport = { width: 1080, height: 675 } as const;

describe("action viewport policy", () => {
  it("accepts coordinates at the inclusive lower and exclusive upper bounds", () => {
    expect(validateActionBounds({ type: "MOVE", x: 0, y: 0 }, viewport)).toEqual({ valid: true });
    expect(validateActionBounds({ type: "CLICK", x: 1079, y: 674, purpose: "response" }, viewport)).toEqual({ valid: true });
  });

  it("rejects out-of-bounds coordinates without returning replacements", () => {
    expect(validateActionBounds({ type: "MOVE", x: 1080, y: 675 }, viewport)).toEqual({
      valid: false,
      error: "coordinates outside viewport",
    });
    expect(validateActionBounds({ type: "DONE" }, viewport)).toEqual({ valid: true });
  });
});
