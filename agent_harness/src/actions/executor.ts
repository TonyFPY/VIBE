import type { BrowserSession } from "../browser/browser-types";
import type { AgentAction } from "./contract";

export async function executeAgentAction(session: BrowserSession, action: AgentAction): Promise<"done" | "executed"> {
  if (action.type === "DONE") return "done";
  if (action.type === "MOVE") await session.move(action.x, action.y);
  else await session.click(action.x, action.y);
  return "executed";
}
