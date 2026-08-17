import type { BrowserSession } from "../browser/browser-types";
import type { ActionResult, ComputerAction } from "./contract";

export type Sleep = (milliseconds: number) => Promise<void>;

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
