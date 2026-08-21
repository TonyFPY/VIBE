export const AGENT_BROWSER_VIEWPORT = { width: 1080, height: 675 } as const;

export interface AgentBrowserConfig {
  url: string;
  runId: string;
  runsRoot: string;
  headless: boolean;
  viewport: typeof AGENT_BROWSER_VIEWPORT;
  screenshotQuality: number;
  settleDelayMs: number;
  navigationTimeoutMs: number;
  mouseMoveSteps: number;
  mouseMoveDelayMs: number;
  repeatedSequenceLimit: number;
}

const DEFAULT_RUNS_ROOT = "runs";
const DEFAULT_SCREENSHOT_QUALITY = 90;
const DEFAULT_SETTLE_DELAY_MS = 2_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 10_000;
const DEFAULT_MOUSE_MOVE_STEPS = 8;
const DEFAULT_MOUSE_MOVE_DELAY_MS = 20;
const DEFAULT_REPEATED_SEQUENCE_LIMIT = 5;

function requiredEnvironment(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]?.trim();
  if (!value) throw new Error(key + " is required");
  return value;
}

function parseBoolean(value: string | undefined, key: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(key + " must be true or false");
}

function parseInteger(
  value: string | undefined,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(key + " must be an integer from " + minimum + " through " + maximum);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(key + " must be an integer from " + minimum + " through " + maximum);
  }
  return parsed;
}

function validateExperimentUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("AGENT_BROWSER_URL must be a valid HTTP or HTTPS URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("AGENT_BROWSER_URL must use HTTP or HTTPS");
  }
  if (!/^\/tasks\/(visual-similarity|object-matching)\/?$/.test(url.pathname)) {
    throw new Error("AGENT_BROWSER_URL must target a supported experiment task");
  }
  if (!/^A\d{1,12}$/.test(url.searchParams.get("participant_id") ?? "")) {
    throw new Error("AGENT_BROWSER_URL must contain a numeric A-prefixed participant_id");
  }
  if (!url.searchParams.get("model")?.trim()) {
    throw new Error("AGENT_BROWSER_URL must contain a model query parameter");
  }
  const runMode = url.searchParams.get("run");
  if (runMode !== "dev" && runMode !== "ops") {
    throw new Error("AGENT_BROWSER_URL must contain run=dev or run=ops");
  }
}

export function parseAgentBrowserConfig(environment: NodeJS.ProcessEnv): AgentBrowserConfig {
  const url = requiredEnvironment(environment, "AGENT_BROWSER_URL");
  const runId = requiredEnvironment(environment, "AGENT_BROWSER_RUN_ID");
  const runsRoot = environment.AGENT_RUNS_DIR?.trim() || DEFAULT_RUNS_ROOT;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(runId)) {
    throw new Error("AGENT_BROWSER_RUN_ID contains unsupported characters");
  }
  validateExperimentUrl(url);

  return {
    url,
    runId,
    runsRoot,
    headless: parseBoolean(environment.AGENT_BROWSER_HEADLESS, "AGENT_BROWSER_HEADLESS", true),
    viewport: AGENT_BROWSER_VIEWPORT,
    screenshotQuality: parseInteger(
      environment.AGENT_BROWSER_SCREENSHOT_QUALITY,
      "AGENT_BROWSER_SCREENSHOT_QUALITY",
      DEFAULT_SCREENSHOT_QUALITY,
      80,
      100,
    ),
    settleDelayMs: parseInteger(
      environment.AGENT_BROWSER_SETTLE_DELAY_MS,
      "AGENT_BROWSER_SETTLE_DELAY_MS",
      DEFAULT_SETTLE_DELAY_MS,
      0,
      10_000,
    ),
    navigationTimeoutMs: parseInteger(
      environment.AGENT_BROWSER_NAVIGATION_TIMEOUT_MS,
      "AGENT_BROWSER_NAVIGATION_TIMEOUT_MS",
      DEFAULT_NAVIGATION_TIMEOUT_MS,
      100,
      120_000,
    ),
    mouseMoveSteps: parseInteger(
      environment.AGENT_BROWSER_MOUSE_MOVE_STEPS,
      "AGENT_BROWSER_MOUSE_MOVE_STEPS",
      DEFAULT_MOUSE_MOVE_STEPS,
      1,
      100,
    ),
    mouseMoveDelayMs: parseInteger(
      environment.AGENT_BROWSER_MOUSE_MOVE_DELAY_MS,
      "AGENT_BROWSER_MOUSE_MOVE_DELAY_MS",
      DEFAULT_MOUSE_MOVE_DELAY_MS,
      0,
      1_000,
    ),
    repeatedSequenceLimit: parseInteger(
      environment.AGENT_BROWSER_REPEATED_SEQUENCE_LIMIT,
      "AGENT_BROWSER_REPEATED_SEQUENCE_LIMIT",
      DEFAULT_REPEATED_SEQUENCE_LIMIT,
      2,
      100,
    ),
  };
}
