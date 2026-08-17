import { resolveModelSpec } from "./model-catalog";
import type { HarnessConfig, HarnessConfigInput, PerformanceConfig, Viewport } from "./types";

const DEFAULT_VIEWPORT: Viewport = { width: 1080, height: 675 };
const DEFAULT_PERFORMANCE: PerformanceConfig = {
  outputTokens: 512,
  connectTimeoutMs: 10_000,
  requestTimeoutMs: 60_000,
  totalRunTimeoutMs: 1_800_000,
  settleDelayMs: 100,
  maxResponseBytes: 32_768,
  maxProviderRetries: 2,
};

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
  if (!/^\d{3,12}$/.test(participantId)) throw new Error("participantId must contain 3 to 12 digits without a prefix");
  const model = requireString(input, "model");
  const location = requireString(input, "location");
  const modelSpec = resolveModelSpec(model, location);
  if (!modelSpec.supportsVision) throw new Error(`Model ${model} does not support vision`);
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
    location,
    runMode,
    viewport: DEFAULT_VIEWPORT,
    screenshotQuality: boundedInteger(input.screenshotQuality, 90, "screenshotQuality", 80, 100),
    maxSteps: boundedInteger(input.maxSteps, 100, "maxSteps", 1, 10_000),
    maxInvalidActions: boundedInteger(input.maxInvalidActions, 3, "maxInvalidActions", 0, 100),
    performance: {
      outputTokens: boundedInteger(performanceRecord.outputTokens, 512, "outputTokens", 16, 1024),
      connectTimeoutMs: boundedInteger(performanceRecord.connectTimeoutMs, 10_000, "connectTimeoutMs", 100, 120_000),
      requestTimeoutMs: boundedInteger(performanceRecord.requestTimeoutMs, 60_000, "requestTimeoutMs", 1000, 600_000),
      totalRunTimeoutMs: boundedInteger(performanceRecord.totalRunTimeoutMs, 1_800_000, "totalRunTimeoutMs", 1000, 86_400_000),
      settleDelayMs: boundedInteger(performanceRecord.settleDelayMs, 100, "settleDelayMs", 0, 10_000),
      maxResponseBytes: boundedInteger(performanceRecord.maxResponseBytes, 32_768, "maxResponseBytes", 1024, 1_048_576),
      maxProviderRetries: boundedInteger(performanceRecord.maxProviderRetries, 2, "maxProviderRetries", 0, 5),
    },
  };
}

export function buildTaskUrl(input: Pick<HarnessConfigInput, "taskUrl" | "participantId" | "model" | "runMode">): string {
  const url = parseTaskUrl(input.taskUrl);
  if (!/^\d{3,12}$/.test(input.participantId)) throw new Error("participantId must contain 3 to 12 digits without a prefix");
  if (input.runMode !== "dev" && input.runMode !== "ops") throw new Error("runMode must be dev or ops");
  url.search = "";
  url.searchParams.set("participant_id", `A${input.participantId}`);
  url.searchParams.set("model", input.model);
  url.searchParams.set("run", input.runMode);
  return url.toString();
}
