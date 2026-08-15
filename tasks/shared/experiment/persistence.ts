import type { SessionPayload } from "./types";

const defaultResultsEndpoint = "/api/experiments/sessions";

export function resultsEndpoint(
  environment: Record<string, string | undefined> = (
    import.meta as ImportMeta & { env: Record<string, string | undefined> }
  ).env,
): string {
  return environment.VITE_RESULTS_ENDPOINT?.trim() || defaultResultsEndpoint;
}

const storageKey = (sessionId: string) => `visual-similarity:${sessionId}`;

export function saveRecovery(payload: SessionPayload): void {
  localStorage.setItem(storageKey(payload.session.sessionId), JSON.stringify(payload));
}

export function clearRecovery(sessionId: string): void {
  localStorage.removeItem(storageKey(sessionId));
}

export async function submitSession(payload: SessionPayload, endpoint = resultsEndpoint()): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": payload.session.sessionId },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Results API returned ${response.status}`);
}
