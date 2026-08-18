import { describe, expect, it } from "vitest";

import { executeComputerAction, executeComputerActionBatch } from "../../src/actions/executor";
import type { ComputerAction } from "../../src/actions/contract";

describe("computer action executor", () => {
  it("rejects a runtime-invalid action without executing or repairing it", async () => {
    const browserActions: string[] = [];
    const session = {
      click: async () => { browserActions.push("click"); },
      move: async () => { browserActions.push("move"); },
    };
    const sleep = async () => { browserActions.push("sleep"); };
    const invalidAction = { type: "navigate" } as unknown as ComputerAction;

    const result = await executeComputerAction(session, invalidAction, sleep);

    expect(result).toEqual({
      action: invalidAction,
      status: "rejected",
      error: "Unsupported computer action type",
    });
    expect(browserActions).toEqual([]);
  });

  it("executes a batch in order without taking screenshots", async () => {
    const browserActions: string[] = [];
    const session = {
      click: async (x: number, y: number) => { browserActions.push(`click:${x},${y}`); },
      move: async (x: number, y: number) => { browserActions.push(`move:${x},${y}`); },
      screenshot: async () => {
        throw new Error("screenshot should not be called");
      },
    };
    const sleep = async (milliseconds: number) => { browserActions.push(`sleep:${milliseconds}`); };
    const actions: ComputerAction[] = [
      { type: "move", x: 10, y: 20 },
      { type: "move", x: 30, y: 40 },
      { type: "click", x: 50, y: 60 },
    ];

    const result = await executeComputerActionBatch(session, actions, sleep);

    expect(browserActions).toEqual(["move:10,20", "move:30,40", "click:50,60"]);
    expect(result.results).toEqual(actions.map((action) => ({ action, status: "executed" })));
    expect(result.failed).toBe(false);
  });

  it("stops after the first failed action", async () => {
    const browserActions: string[] = [];
    const session = {
      click: async () => { browserActions.push("click"); },
      move: async (x: number) => {
        browserActions.push(`move:${x}`);
        if (x === 2) throw new Error("browser stopped");
      },
    };
    const actions: ComputerAction[] = [
      { type: "move", x: 1, y: 1 },
      { type: "move", x: 2, y: 2 },
      { type: "click", x: 3, y: 3 },
    ];

    const result = await executeComputerActionBatch(session, actions, async () => undefined);

    expect(browserActions).toEqual(["move:1", "move:2"]);
    expect(result.results).toHaveLength(2);
    expect(result.results[1]).toMatchObject({ action: actions[1], status: "failed", error: "browser stopped" });
    expect(result.failed).toBe(true);
  });
});
