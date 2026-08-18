import type { BrowserSession } from "../browser/browser-types";
import type { ActionResult, ComputerAction } from "./contract";

export type Sleep = (milliseconds: number) => Promise<void>;

export interface ActionBatchExecution {
  results: ActionResult[];
  failed: boolean;
}

export async function executeComputerAction(
  session: Pick<BrowserSession, "click" | "move">,
  action: ComputerAction,
  sleep: Sleep,
): Promise<ActionResult> {
  try {
    if (action.type === "click") await session.click(action.x, action.y);
    else if (action.type === "move") await session.move(action.x, action.y);
    else if (action.type === "wait") await sleep(action.milliseconds);
    else return { action, status: "rejected", error: "Unsupported computer action type" };
    return { action, status: "executed" };
  } catch (error) {
    return {
      action,
      status: "failed",
      error: error instanceof Error ? error.message : "Action execution failed",
    };
  }
}

export async function executeComputerActionBatch(
  session: Pick<BrowserSession, "click" | "move">,
  actions: readonly ComputerAction[],
  sleep: Sleep,
): Promise<ActionBatchExecution> {
  const results: ActionResult[] = [];
  for (const action of actions) {
    const result = await executeComputerAction(session, action, sleep);
    results.push(result);
    if (result.status === "failed") return { results, failed: true };
  }
  return { results, failed: false };
}
