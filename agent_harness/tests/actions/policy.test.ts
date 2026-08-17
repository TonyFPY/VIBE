import { describe, expect, it } from "vitest";

import { validateComputerAction } from "../../src/actions/policy";

const viewport = { width: 1080, height: 675 } as const;

describe("computer action viewport and wait policy", () => {
  it("uses inclusive lower and exclusive upper CSS pixel bounds", () => {
    expect(validateComputerAction({ type: "click", x: 0, y: 0 }, viewport)).toEqual({ valid: true });
    expect(validateComputerAction({ type: "move", x: 1079, y: 674 }, viewport)).toEqual({ valid: true });
    expect(validateComputerAction({ type: "click", x: 1080, y: 675 }, viewport)).toMatchObject({ valid: false });
  });

  it("accepts only waits from zero through five seconds", () => {
    expect(validateComputerAction({ type: "wait", milliseconds: 0 }, viewport)).toEqual({ valid: true });
    expect(validateComputerAction({ type: "wait", milliseconds: 5000 }, viewport)).toEqual({ valid: true });
    expect(validateComputerAction({ type: "wait", milliseconds: 10001 }, viewport)).toMatchObject({ valid: false });
  });
});
