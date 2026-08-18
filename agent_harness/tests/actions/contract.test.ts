import { describe, expect, it } from "vitest";

import { validateComputerAction } from "../../src/actions/policy";

const viewport = { width: 1080, height: 675 } as const;

describe("shared computer action contract", () => {
  it("accepts the lowercase click, move, and bounded wait actions", () => {
    expect(validateComputerAction({ type: "click", x: 0, y: 0 }, viewport)).toEqual({ valid: true });
    expect(validateComputerAction({ type: "move", x: 1079, y: 674 }, viewport)).toEqual({ valid: true });
    expect(validateComputerAction({ type: "wait", milliseconds: 5000 }, viewport)).toEqual({ valid: true });
  });

  it("rejects unsupported actions and provider-specific fields", () => {
    expect(validateComputerAction({ type: "finish" }, viewport)).toMatchObject({ valid: false });
    expect(validateComputerAction({ type: "tap", x: 1, y: 2, purpose: "response" }, viewport)).toMatchObject({ valid: false });
    expect(validateComputerAction({ type: "click", x: 1, y: 2, purpose: "response" }, viewport)).toMatchObject({ valid: false });
    expect(validateComputerAction({ type: "click", x: 1, y: 2, page: { evaluate: "document.body" } }, viewport)).toMatchObject({ valid: false });
    expect(validateComputerAction({ type: "type", text: "secret" }, viewport)).toMatchObject({ valid: false });
    expect(validateComputerAction({ type: "scroll", x: 1, y: 2 }, viewport)).toMatchObject({ valid: false });
  });

  it("rejects non-finite, negative, out-of-range, and extra values without replacements", () => {
    const invalidActions: unknown[] = [
      { type: "click", x: Number.NaN, y: 0 },
      { type: "move", x: Number.POSITIVE_INFINITY, y: 0 },
      { type: "click", x: -1, y: 0 },
      { type: "click", x: 1080, y: 675 },
      { type: "wait", milliseconds: -1 },
      { type: "wait", milliseconds: 10001 },
      { type: "wait", milliseconds: 5000, extra: "SECRET_ANSWER_CANARY" },
    ];

    for (const action of invalidActions) {
      const result = validateComputerAction(action, viewport);
      expect(result.valid).toBe(false);
      expect(result).not.toHaveProperty("action");
    }
  });
});
