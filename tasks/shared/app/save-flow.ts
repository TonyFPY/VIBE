import {
  clearRecovery as clearStoredRecovery,
  submitSession as submitStoredSession,
  type SaveAttemptError,
  type SubmitSessionOptions,
} from "../experiment/persistence";
import type { SessionPayload } from "../experiment/types";
import { renderSaveState } from "./save-status";

type Submitter = (payload: SessionPayload, options: SubmitSessionOptions) => Promise<void>;

export interface FinishSessionOptions {
  root: HTMLElement;
  payload: SessionPayload;
  endpoint?: string;
  checkpoint: () => void;
  download: (name: string, contents: unknown) => void;
  clearRecovery?: (sessionId: string) => void;
  submit?: Submitter;
  closeWindow?: () => void;
}

export type FinishSessionResult = "manual" | "saved" | "failed";

function attachDownloads(
  root: HTMLElement,
  payload: SessionPayload,
  download: FinishSessionOptions["download"],
): void {
  const sessionId = payload.session.sessionId;
  root.querySelector("#download-results")?.addEventListener("click", () => {
    download(`results/${sessionId}.json`, { session: payload.session, results: payload.results });
  });
  root.querySelector("#download-trajectories")?.addEventListener("click", () => {
    download(`trajectories/${sessionId}.json`, { session: payload.session, trajectories: payload.trajectories });
  });
}

function failureMessage(error: unknown): string {
  const saveError = error as Partial<SaveAttemptError>;
  if (saveError.kind === "timeout") return "The save service timed out. Download recovery copies below.";
  if (saveError.kind === "http") return `The save service returned an error${saveError.status ? ` (${saveError.status})` : ""}. Download recovery copies below.`;
  return "The save service could not be reached. Download recovery copies below.";
}

export async function finishSession(options: FinishSessionOptions): Promise<FinishSessionResult> {
  const {
    root,
    payload,
    endpoint,
    checkpoint,
    download,
    clearRecovery = clearStoredRecovery,
    submit = submitStoredSession,
    closeWindow,
  } = options;

  checkpoint();
  if (!endpoint?.trim()) {
    renderSaveState(root, {
      kind: "manual",
      message: "No save API is configured. Download both files to keep a copy of this run.",
    });
    attachDownloads(root, payload, download);
    return "manual";
  }

  try {
    await submit(payload, {
      endpoint,
      onAttempt: (attempt, maxAttempts) => renderSaveState(root, { kind: "saving", attempt, maxAttempts }),
    });
    clearRecovery(payload.session.sessionId);
    renderSaveState(root, { kind: "saved" });
    closeWindow?.();
    return "saved";
  } catch (error) {
    renderSaveState(root, { kind: "failed", message: failureMessage(error) });
    attachDownloads(root, payload, download);
    return "failed";
  }
}
