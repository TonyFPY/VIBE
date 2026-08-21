import { describe, expect, it } from "vitest";

import { validatePointerAction, validateWaitAction } from "../../src/agent-browser/action-policy";

const viewport = { width: 1080, height: 675 } as const;

describe("validatePointerAction", () => {
  it("accepts finite pointer coordinates inside the visible viewport", () => {
    expect(validatePointerAction({ type: "move", x: 0, y: 0 }, viewport)).toEqual({ valid: true });
    expect(validatePointerAction({ type: "click", x: 1079.5, y: 674.5 }, viewport)).toEqual({ valid: true });
  });

  it.each([
    { type: "click", x: -1, y: 10 },
    { type: "move", x: 1080, y: 10 },
    { type: "move", x: 10, y: 675 },
    { type: "click", x: Number.NaN, y: 10 },
    { type: "click", x: 10, y: Number.POSITIVE_INFINITY },
  ])("rejects coordinates outside the visible viewport: %j", (action) => {
    expect(validatePointerAction(action, viewport)).toMatchObject({ valid: false });
  });

  it("rejects unknown action types and extra fields instead of repairing them", () => {
    expect(validatePointerAction({ type: "scroll", x: 10, y: 10 }, viewport)).toMatchObject({ valid: false });
    expect(validatePointerAction({ type: "click", x: 10, y: 10, answer: "SECRET_ANSWER_CANARY" }, viewport)).toMatchObject({ valid: false });
  });
});

describe("validateWaitAction", () => {
 it("accepts a bounded wait duration", () => {
    expect(validateWaitAction({ milliseconds: 0 })).toEqual({ valid: true });
    expect(validateWaitAction({ milliseconds: 5000 })).toEqual({ valid: true });
 });

  it.each([-1, 5001, Number.NaN, Number.POSITIVE_INFINITY, "100"])(
   "rejects an unsafe wait duration: %j",
   (milliseconds) => {
      expect(validateWaitAction({ milliseconds })).toMatchObject({ valid: false });
   },
 );

  it("rejects extra wait fields instead of silently ignoring them", () => {
    expect(validateWaitAction({ milliseconds: 10, answer: "SECRET_ANSWER_CANARY" })).toMatchObject({ valid: false });
  });
});
