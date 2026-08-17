import type { AgentAction } from "./contract";

export type ActionPolicyResult = { valid: true } | { valid: false; error: string };

export function validateActionBounds(
  action: AgentAction,
  viewport: { width: number; height: number },
): ActionPolicyResult {
  if (action.type === "DONE") return { valid: true };
  if (action.x >= viewport.width || action.y >= viewport.height) {
    return { valid: false, error: "coordinates outside viewport" };
  }
  return { valid: true };
}
