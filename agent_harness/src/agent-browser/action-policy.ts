export interface AgentBrowserViewport {
  width: number;
  height: number;
}

export type ActionValidation = { valid: true } | { valid: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isVisibleCoordinate(value: unknown, maximumExclusive: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value < maximumExclusive;
}

export function validatePointerAction(
  action: unknown,
  viewport: AgentBrowserViewport,
): ActionValidation {
  if (!isRecord(action) || (action.type !== "move" && action.type !== "click")) {
    return { valid: false, error: "Action type must be move or click" };
  }
  if (!hasOnlyKeys(action, ["type", "x", "y"])) {
    return { valid: false, error: "Pointer action contains unsupported or missing fields" };
  }
  if (!isVisibleCoordinate(action.x, viewport.width) || !isVisibleCoordinate(action.y, viewport.height)) {
    return { valid: false, error: "Pointer coordinates must be finite CSS pixels inside the viewport" };
  }
  return { valid: true };
}

export function validateWaitAction(milliseconds: unknown): ActionValidation {
  if (!isRecord(milliseconds) || !hasOnlyKeys(milliseconds, ["milliseconds"])) {
    return { valid: false, error: "Wait action contains unsupported or missing fields" };
  }
  const duration = milliseconds.milliseconds;
 if (
    typeof duration !== "number"
    || !Number.isFinite(duration)
    || duration < 0
    || duration > 5_000
 ) {
   return { valid: false, error: "Wait milliseconds must be finite and between 0 and 5000" };
 }
 return { valid: true };
}
