export type ComputerActionValidation = { valid: true } | { valid: false; error: string };

export type ActionBatchPhase = "setup" | "trial" | "wait";

// Adjust these two totals to change the trial action budget. The Gemini
// custom-function move bounds derive from them below.
export const MAX_BATCH_ACTIONS = 50;
export const MIN_TRIAL_BATCH_ACTIONS = 10;
export const MIN_TRIAL_MOVES = MIN_TRIAL_BATCH_ACTIONS - 1;
export const MAX_TRIAL_MOVES = MAX_BATCH_ACTIONS - 1;

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

export function validateComputerActionBatch(
  actions: readonly unknown[],
  viewport: Viewport,
  phase: ActionBatchPhase,
): ComputerActionValidation {
  if (actions.length === 0) return { valid: false, error: "Batch must contain at least one action" };
  if (actions.length > MAX_BATCH_ACTIONS) {
    return { valid: false, error: `Batch cannot contain more than ${MAX_BATCH_ACTIONS} actions` };
  }
  if (phase === "wait") {
    if (actions.length !== 1 || !isRecord(actions[0]) || actions[0].type !== "wait") {
      return { valid: false, error: "Wait batch must contain exactly one wait action" };
    }
    const validation = validateComputerAction(actions[0], viewport);
    return validation.valid ? { valid: true } : { valid: false, error: `Invalid wait action: ${validation.error}` };
  }
  if (phase === "setup" && actions.length !== 1) {
    return { valid: false, error: "Setup batch must contain exactly one click" };
  }
  if (phase === "trial" && actions.length < MIN_TRIAL_BATCH_ACTIONS) {
    return { valid: false, error: `Trial batch must contain at least ${MIN_TRIAL_BATCH_ACTIONS} actions` };
  }

  const finalAction = actions[actions.length - 1];
  if (!isRecord(finalAction) || finalAction.type !== "click") {
    return { valid: false, error: "Batch final action must be click" };
  }
  for (const action of actions.slice(0, -1)) {
    if (!isRecord(action) || action.type !== "move") {
      return { valid: false, error: "Batch actions before the final action must be move" };
    }
  }

  for (const action of actions) {
    const validation = validateComputerAction(action, viewport);
    if (!validation.valid) return { valid: false, error: `Invalid batch action: ${validation.error}` };
  }
  return { valid: true };
}
