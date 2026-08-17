export type ComputerActionValidation = { valid: true } | { valid: false; error: string };

interface Viewport {
  width: number;
  height: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function validNumber(value: unknown, minimum: number, maximumExclusive?: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    (maximumExclusive === undefined || value < maximumExclusive)
  );
}

export function validateComputerAction(action: unknown, viewport: Viewport): ComputerActionValidation {
  if (!isRecord(action) || typeof action.type !== "string") {
    return { valid: false, error: "Action must be an object with a supported type" };
  }

  if (action.type === "click" || action.type === "move") {
    if (!hasOnlyKeys(action, ["type", "x", "y"])) {
      return { valid: false, error: `${action.type} contains unsupported or missing fields` };
    }
    if (!validNumber(action.x, 0, viewport.width) || !validNumber(action.y, 0, viewport.height)) {
      return { valid: false, error: `${action.type} coordinates must be finite CSS pixels inside the viewport` };
    }
    return { valid: true };
  }

  if (action.type === "wait") {
    if (!hasOnlyKeys(action, ["type", "milliseconds"])) {
      return { valid: false, error: "wait contains unsupported or missing fields" };
    }
    if (!validNumber(action.milliseconds, 0, 5001)) {
      return { valid: false, error: "wait milliseconds must be finite and between 0 and 5000" };
    }
    return { valid: true };
  }

  return { valid: false, error: "Action type must be click, move, or wait" };
}
