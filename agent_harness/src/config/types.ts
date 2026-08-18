export type HarnessRunMode = "dev" | "ops";

export interface Viewport {
  width: 1080;
  height: 675;
}

export interface PerformanceConfig {
  outputTokens: number;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  totalRunTimeoutMs: number;
  settleDelayMs: number;
  maxResponseBytes: number;
  maxProviderRetries: number;
}

export interface HarnessConfig {
  taskUrl: string;
  participantId: string;
  model: string;
  runMode: HarnessRunMode;
  viewport: Viewport;
  screenshotQuality: number;
  mouseMoveSteps: number;
  maxSteps: number;
  maxInvalidActions: number;
  performance: PerformanceConfig;
}

export type HarnessConfigInput = Pick<
  HarnessConfig,
  "taskUrl" | "participantId" | "model" | "runMode"
> & Partial<Omit<HarnessConfig, "taskUrl" | "participantId" | "model" | "runMode">>;
