export type ClickPurpose = "navigation" | "fixation" | "response";

export interface ClickAction {
  type: "CLICK";
  x: number;
  y: number;
  purpose: ClickPurpose;
}

export interface DoneAction {
  type: "DONE";
}

export type AgentAction = ClickAction | DoneAction;

export type AgentActionParseResult =
  | { valid: true; action: AgentAction }
  | { valid: false; error: string };

const clickPurposes: ReadonlySet<string> = new Set(["navigation", "fixation", "response"]);

export function parseAgentAction(raw: unknown): AgentActionParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, error: "Action must be an object" };
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.type === "DONE") {
    return Object.keys(candidate).length === 1
      ? { valid: true, action: { type: "DONE" } }
      : { valid: false, error: "DONE does not accept additional fields" };
  }
  if (candidate.type !== "CLICK") {
    return { valid: false, error: "Action type must be CLICK or DONE" };
  }
  if (!clickPurposes.has(String(candidate.purpose))) {
    return { valid: false, error: "CLICK purpose must be navigation, fixation, or response" };
  }
  if (typeof candidate.x !== "number" || !Number.isFinite(candidate.x) || candidate.x < 0) {
    return { valid: false, error: "CLICK x must be a finite non-negative number" };
  }
  if (typeof candidate.y !== "number" || !Number.isFinite(candidate.y) || candidate.y < 0) {
    return { valid: false, error: "CLICK y must be a finite non-negative number" };
  }
  if (Object.keys(candidate).some((key) => !["type", "x", "y", "purpose"].includes(key))) {
    return { valid: false, error: "CLICK contains unsupported fields" };
  }
  return {
    valid: true,
    action: {
      type: "CLICK",
      x: candidate.x,
      y: candidate.y,
      purpose: candidate.purpose as ClickPurpose,
    },
  };
}
