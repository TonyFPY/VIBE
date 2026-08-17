import type { TimingSummary } from "../metrics/timing";

export type RunStatus = "completed" | "incomplete" | "failed";

export interface RunTimingSummary {
  navigation: TimingSummary;
  screenshotAndLog: TimingSummary;
  provider: TimingSummary;
  parseAndValidate: TimingSummary;
  actionAndLog: TimingSummary;
  settle: TimingSummary;
}

export interface RunSummary {
  status: RunStatus;
  stepCount: number;
  observationCount: number;
  actionCount: number;
  invalidActionCount: number;
  timings: RunTimingSummary;
  failureReason?: string;
}
