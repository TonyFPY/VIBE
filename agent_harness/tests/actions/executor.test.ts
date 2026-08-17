import { describe, expect, it } from "vitest";

import { executeComputerAction } from "../../src/actions/executor";
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
});
