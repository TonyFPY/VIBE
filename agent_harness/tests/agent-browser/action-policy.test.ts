import { describe, expect, it } from "vitest";

import {
  MIN_TRAJECTORY_WAYPOINTS,
  MAX_TRAJECTORY_WAYPOINTS,
  validatePointerAction,
  validateTrajectoryAction,
  validateWaitAction,
} from "../../src/agent-browser/action-policy";

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

describe("validateTrajectoryAction", () => {
  it("allows the full 25-waypoint trajectory budget", () => {
    expect(MIN_TRAJECTORY_WAYPOINTS).toBe(5);
    expect(MAX_TRAJECTORY_WAYPOINTS).toBe(25);
    expect(validateTrajectoryAction({
      waypoints: Array.from({ length: MAX_TRAJECTORY_WAYPOINTS }, (_, index) => ({ x: 220 + index, y: 333 })),
    }, viewport)).toEqual({ valid: true });
  });

  it("requires at least five ordered waypoints", () => {
    expect(validateTrajectoryAction({
      waypoints: Array.from({ length: MIN_TRAJECTORY_WAYPOINTS - 1 }, () => ({ x: 220, y: 333 })),
    }, viewport)).toMatchObject({ valid: false });
  });

  it("accepts an ordered in-viewport path with an intermediate point and an endpoint", () => {
    expect(validateTrajectoryAction({
      waypoints: [
        { x: 470, y: 334 },
        { x: 420, y: 333 },
        { x: 380, y: 332 },
        { x: 300, y: 333 },
        { x: 220, y: 333 },
      ],
    }, viewport)).toEqual({ valid: true });
  });

  it.each([
    { waypoints: [{ x: 220, y: 333 }] },
    { waypoints: Array.from({ length: MAX_TRAJECTORY_WAYPOINTS + 1 }, () => ({ x: 220, y: 333 })) },
    { waypoints: [{ x: -1, y: 333 }, { x: 220, y: 333 }] },
    { waypoints: [{ x: 470, y: 334, answer: "SECRET_ANSWER_CANARY" }, { x: 220, y: 333 }] },
    { waypoints: [{ x: 470, y: 334 }, { x: 220, y: 333 }], answer: "SECRET_ANSWER_CANARY" },
  ])("rejects unsafe trajectory input: %j", (action) => {
    expect(validateTrajectoryAction(action, viewport)).toMatchObject({ valid: false });
  });
});
