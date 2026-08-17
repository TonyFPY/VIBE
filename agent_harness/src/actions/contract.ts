export type ClickPurpose = "navigation" | "fixation" | "response";
export type AgentActionType = "CLICK" | "MOVE" | "DONE";

export interface ClickAction {
  type: "CLICK";
  x: number;
  y: number;
  purpose: ClickPurpose;
}

export interface MoveAction {
  type: "MOVE";
  x: number;
  y: number;
}

export interface DoneAction {
  type: "DONE";
}

export type AgentAction = ClickAction | MoveAction | DoneAction;

export type AgentActionParseResult =
  | { valid: true; action: AgentAction }
  | { valid: false; error: string };

const clickPurposes: ReadonlySet<string> = new Set(["navigation", "fixation", "response"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key)) && Object.keys(value).length === allowed.length;
}

function validCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function parseAgentAction(raw: unknown): AgentActionParseResult {
  if (!isRecord(raw)) return { valid: false, error: "Action must be an object" };

  if (raw.type === "DONE") {
    return hasOnlyKeys(raw, ["type"])
      ? { valid: true, action: { type: "DONE" } }
      : { valid: false, error: "DONE does not accept additional fields" };
  }

  if (raw.type === "MOVE") {
    if (!hasOnlyKeys(raw, ["type", "x", "y"])) return { valid: false, error: "MOVE contains unsupported or missing fields" };
    if (!validCoordinate(raw.x) || !validCoordinate(raw.y)) return { valid: false, error: "MOVE coordinates must be finite non-negative numbers" };
    return { valid: true, action: { type: "MOVE", x: raw.x, y: raw.y } };
  }

  if (raw.type === "CLICK") {
    if (!hasOnlyKeys(raw, ["type", "x", "y", "purpose"])) return { valid: false, error: "CLICK contains unsupported or missing fields" };
    if (!validCoordinate(raw.x) || !validCoordinate(raw.y)) return { valid: false, error: "CLICK coordinates must be finite non-negative numbers" };
    if (!clickPurposes.has(String(raw.purpose))) return { valid: false, error: "CLICK purpose must be navigation, fixation, or response" };
    return {
      valid: true,
      action: { type: "CLICK", x: raw.x, y: raw.y, purpose: raw.purpose as ClickPurpose },
    };
  }

  return { valid: false, error: "Action type must be CLICK, MOVE, or DONE" };
}
