export type RunStatus = "completed" | "incomplete" | "failed";

export interface RunSummary {
  status: RunStatus;
  stepCount: number;
  observationCount: number;
  actionCount: number;
  invalidActionCount: number;
  failureReason?: string;
}
