import type { SessionPayload } from "./types";

const storageKey = (sessionId: string) => `visual-similarity:${sessionId}`;

export function saveRecovery(payload: SessionPayload): void {
  localStorage.setItem(storageKey(payload.session.sessionId), JSON.stringify(payload));
}

export function clearRecovery(sessionId: string): void {
  localStorage.removeItem(storageKey(sessionId));
}

export async function submitSession(payload: SessionPayload, endpoint = "/api/experiments/sessions"): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": payload.session.sessionId },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Results API returned ${response.status}`);
}
