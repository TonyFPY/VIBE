import { describe, expect, it } from "vitest";

import {
  MAX_BATCH_ACTIONS,
  MIN_TRIAL_BATCH_ACTIONS,
  validateComputerAction,
  validateComputerActionBatch,
} from "../../src/actions/policy";
import type { ComputerAction } from "../../src/actions/contract";

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

  it("accepts a setup batch with exactly one click", () => {
    expect(
      validateComputerActionBatch(
        [{ type: "click", x: 30, y: 40 }],
        viewport,
        "setup",
      ),
    ).toEqual({ valid: true });
  });

  it("accepts exactly one five-second wait batch outside trial responses", () => {
    expect(validateComputerActionBatch([{ type: "wait", milliseconds: 5000 }], viewport, "wait" as never))
      .toEqual({ valid: true });
  });

  it("rejects a trial-sized setup batch so Start remains a single visible click", () => {
    const trialSizedBatch = [
      ...Array.from({ length: MIN_TRIAL_BATCH_ACTIONS - 1 }, (_, index) => ({
        type: "move" as const,
        x: index,
        y: index,
      })),
      { type: "click" as const, x: 30, y: 40 },
    ];

    expect(validateComputerActionBatch(trialSizedBatch, viewport, "setup")).toMatchObject({ valid: false });
  });

  it("requires at least ten actions in a trial batch", () => {
    const actions = [...Array.from({ length: MIN_TRIAL_BATCH_ACTIONS - 2 }, (_, index) => ({
      type: "move" as const,
      x: index,
      y: index,
    })), { type: "click" as const, x: 20, y: 20 }];

    expect(validateComputerActionBatch(actions, viewport, "trial")).toMatchObject({ valid: false });
  });

  it("accepts nine moves followed by a click in a trial batch", () => {
    const actions = [...Array.from({ length: MIN_TRIAL_BATCH_ACTIONS - 1 }, (_, index) => ({
      type: "move" as const,
      x: index,
      y: index,
    })), { type: "click" as const, x: 20, y: 20 }];

    expect(validateComputerActionBatch(actions, viewport, "trial")).toEqual({ valid: true });
  });

  it("accepts the maximum batch size and rejects one action beyond it", () => {
    const actions = [...Array.from({ length: MAX_BATCH_ACTIONS - 1 }, (_, index) => ({
      type: "move" as const,
      x: index,
      y: index,
    })), { type: "click" as const, x: 20, y: 20 }];

    expect(validateComputerActionBatch(actions, viewport, "trial")).toEqual({ valid: true });
    expect(validateComputerActionBatch([...actions, { type: "click", x: 20, y: 20 }], viewport, "trial"))
      .toMatchObject({ valid: false });
  });

  it("rejects a click before the final action or a non-move intermediate", () => {
    expect(
      validateComputerActionBatch(
        [{ type: "click", x: 10, y: 10 }, { type: "move", x: 20, y: 20 }],
        viewport,
        "setup",
      ),
    ).toMatchObject({ valid: false });
    expect(
      validateComputerActionBatch(
        [{ type: "wait", milliseconds: 0 }, { type: "click", x: 20, y: 20 }],
        viewport,
        "setup",
      ),
    ).toMatchObject({ valid: false });
  });

  it("applies finite in-viewport validation to every batch action", () => {
    const actions: ComputerAction[] = [
      { type: "move", x: Number.NaN, y: 10 },
      { type: "move", x: 10, y: Number.POSITIVE_INFINITY },
      { type: "click", x: viewport.width, y: 10 },
    ] as const;

    for (const index of actions.keys()) {
      const candidate = actions.map((action, actionIndex) =>
        actionIndex === index ? action : { type: "move" as const, x: 10, y: 10 },
      );
      candidate[candidate.length - 1] = index === candidate.length - 1
        ? actions[index]
        : { type: "click", x: 20, y: 20 };
      expect(validateComputerActionBatch(candidate, viewport, "setup")).toMatchObject({ valid: false });
    }
  });
});
