import type { SessionPayload } from "./types";

export function resultsEndpoint(
  environment: Record<string, string | undefined> = (
    import.meta as ImportMeta & { env: Record<string, string | undefined> }
  ).env,
): string | undefined {
  const configured = environment.VITE_RESULTS_ENDPOINT?.trim();
  return configured || undefined;
}

const storageKey = (sessionId: string) => `visual-similarity:${sessionId}`;

export type SaveAttemptErrorKind = "timeout" | "network" | "http";

export class SaveAttemptError extends Error {
  readonly kind: SaveAttemptErrorKind;
  readonly status?: number;

  constructor(kind: SaveAttemptErrorKind, message: string, status?: number) {
    super(message);
    this.name = "SaveAttemptError";
    this.kind = kind;
    this.status = status;
  }
}

export interface SubmitSessionOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  sleep?: (delayMs: number) => Promise<void>;
  onAttempt?: (attempt: number, maxAttempts: number) => void;
}

export function saveRecovery(payload: SessionPayload): void {
  localStorage.setItem(storageKey(payload.session.sessionId), JSON.stringify(payload));
}

export function clearRecovery(sessionId: string): void {
  localStorage.removeItem(storageKey(sessionId));
}

export async function submitSession(
  payload: SessionPayload,
  options: SubmitSessionOptions = {},
): Promise<void> {
  const endpoint = options.endpoint ?? resultsEndpoint();
  if (!endpoint?.trim()) return;

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxAttempts = Math.min(3, Math.max(1, Math.floor(options.maxAttempts ?? 3)));
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs)));
  const body = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json",
    "Idempotency-Key": payload.session.sessionId,
  };
  let lastError: SaveAttemptError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    options.onAttempt?.(attempt, maxAttempts);
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        lastError = new SaveAttemptError("http", `Results API returned ${response.status}`, response.status);
      } else {
        return;
      }
    } catch (error) {
      if (timedOut || (error instanceof Error && error.name === "AbortError")) {
        lastError = new SaveAttemptError("timeout", "Results API request timed out");
      } else {
        lastError = new SaveAttemptError("network", "Results API request failed");
      }
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < maxAttempts) await sleep(500 * 2 ** (attempt - 1));
  }

  throw lastError ?? new SaveAttemptError("network", "Results API request failed");
}
