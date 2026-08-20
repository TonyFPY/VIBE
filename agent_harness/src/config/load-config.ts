import { resolveModelSpec } from "./model-catalog";
import type { HarnessConfig, HarnessConfigInput, HarnessRunMode, HarnessTask, PerformanceConfig, Viewport } from "./types";

const DEFAULT_VIEWPORT: Viewport = { width: 1080, height: 675 };
const DEFAULT_PERFORMANCE: PerformanceConfig = {
  outputTokens: 2048,
  connectTimeoutMs: 10_000,
  requestTimeoutMs: 120_000,
  totalRunTimeoutMs: 2_700_000,
  settleDelayMs: 2_000,
  maxResponseBytes: 131_072,
  maxProviderRetries: 2,
};
const DEFAULT_MOUSE_MOVE_DELAY_MS = 20;
const PARTICIPANT_ID_PATTERN = /^\d{1,12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}

function boundedInteger(value: unknown, fallback: number, key: string, minimum: number, maximum: number): number {
  const selected = value === undefined ? fallback : value;
  if (!Number.isInteger(selected) || Number(selected) < minimum || Number(selected) > maximum) {
    throw new Error(`${key} must be an integer from ${minimum} through ${maximum}`);
  }
  return Number(selected);
}

function parseTaskUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("taskUrl must be a valid HTTP URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("taskUrl must use HTTP or HTTPS");
  }
  if (!/^\/tasks\/(visual-similarity|object-matching)\/?$/.test(url.pathname)) {
    throw new Error("taskUrl must target a supported task route");
  }
  return url;
}

export function parseHarnessConfig(input: unknown): HarnessConfig {
  if (!isRecord(input)) throw new Error("Configuration must be an object");
  const taskUrl = requireString(input, "taskUrl");
  parseTaskUrl(taskUrl);
  const participantId = requireString(input, "participantId");
  if (!PARTICIPANT_ID_PATTERN.test(participantId)) throw new Error("participantId must contain 1 to 12 digits without a prefix");
  const model = requireString(input, "model");
  resolveModelSpec(model);
  const runMode = input.runMode;
  if (runMode !== "dev" && runMode !== "ops") throw new Error("runMode must be dev or ops");

  const viewport = input.viewport ?? DEFAULT_VIEWPORT;
  if (!isRecord(viewport) || viewport.width !== 1080 || viewport.height !== 675) {
    throw new Error("viewport must be exactly 1080 x 675");
  }
  const performanceInput = input.performance;
  if (performanceInput !== undefined && !isRecord(performanceInput)) {
    throw new Error("performance must be an object");
  }
  const performanceRecord = performanceInput ?? {};

  return {
    taskUrl,
    participantId,
    model,
    runMode,
    viewport: DEFAULT_VIEWPORT,
    screenshotQuality: boundedInteger(input.screenshotQuality, 90, "screenshotQuality", 80, 100),
    mouseMoveSteps: boundedInteger(input.mouseMoveSteps, 1, "mouseMoveSteps", 1, 100),
    mouseMoveDelayMs: boundedInteger(input.mouseMoveDelayMs, DEFAULT_MOUSE_MOVE_DELAY_MS, "mouseMoveDelayMs", 0, 1000),
    maxSteps: boundedInteger(input.maxSteps, 384, "maxSteps", 1, 10_000),
    maxInvalidActions: boundedInteger(input.maxInvalidActions, 3, "maxInvalidActions", 0, 100),
    performance: {
      outputTokens: boundedInteger(performanceRecord.outputTokens, DEFAULT_PERFORMANCE.outputTokens, "outputTokens", 16, 4096),
      connectTimeoutMs: boundedInteger(performanceRecord.connectTimeoutMs, DEFAULT_PERFORMANCE.connectTimeoutMs, "connectTimeoutMs", 100, 120_000),
      requestTimeoutMs: boundedInteger(performanceRecord.requestTimeoutMs, DEFAULT_PERFORMANCE.requestTimeoutMs, "requestTimeoutMs", 1000, 600_000),
      totalRunTimeoutMs: boundedInteger(performanceRecord.totalRunTimeoutMs, DEFAULT_PERFORMANCE.totalRunTimeoutMs, "totalRunTimeoutMs", 1000, 86_400_000),
      settleDelayMs: boundedInteger(performanceRecord.settleDelayMs, DEFAULT_PERFORMANCE.settleDelayMs, "settleDelayMs", 0, 10_000),
      maxResponseBytes: boundedInteger(performanceRecord.maxResponseBytes, DEFAULT_PERFORMANCE.maxResponseBytes, "maxResponseBytes", 1024, 1_048_576),
      maxProviderRetries: boundedInteger(performanceRecord.maxProviderRetries, DEFAULT_PERFORMANCE.maxProviderRetries, "maxProviderRetries", 0, 5),
    },
  };
}

export function buildTaskUrl(input: Pick<HarnessConfigInput, "taskUrl" | "participantId" | "model" | "runMode">): string {
  const url = parseTaskUrl(input.taskUrl);
  if (!PARTICIPANT_ID_PATTERN.test(input.participantId)) throw new Error("participantId must contain 1 to 12 digits without a prefix");
  if (input.runMode !== "dev" && input.runMode !== "ops") throw new Error("runMode must be dev or ops");
  url.search = "";
  url.searchParams.set("participant_id", `A${input.participantId}`);
  url.searchParams.set("model", input.model);
  url.searchParams.set("run", input.runMode);
  return url.toString();
}

export interface BuildTaskUrlFromHostInput {
  host: string;
  task: HarnessTask;
  participantId: string;
  model: string;
  runMode: HarnessRunMode;
}

export function buildTaskUrlFromHost(input: BuildTaskUrlFromHostInput): string {
  let host: URL;
  try {
    host = new URL(input.host);
  } catch {
    throw new Error("host must be a valid HTTP URL");
  }
  if (host.protocol !== "https:" && host.protocol !== "http:") {
    throw new Error("host must use HTTP or HTTPS");
  }
  if (host.pathname !== "" && host.pathname !== "/") {
    throw new Error("host must not include a path");
  }
  if (host.search || host.hash) {
    throw new Error("host must not include a query or fragment");
  }
  host.pathname = `/tasks/${input.task}`;
  return buildTaskUrl({
    taskUrl: host.toString(),
    participantId: input.participantId,
    model: input.model,
    runMode: input.runMode,
  });
}
