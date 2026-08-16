import type { ObserverType, SessionIdentity, SessionRunMode } from "./types";

const safePart = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
const labelPart = (value: string | null, fallback: string) => value?.trim().slice(0, 120) || fallback;
const participantPart = (value: string | undefined, fallback: string) => {
  const normalized = (value ?? fallback).toUpperCase().replace(/^[HA]/, "");
  return normalized.replace(/[^A-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
};

const randomSuffix = () => crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(8, "0");

export function createSessionIdentity(search = window.location.search): SessionIdentity {
  const params = new URLSearchParams(search);
  const rawParticipantId = params.get("participant_id")?.trim() || "H001";
  const participantType: ObserverType = rawParticipantId.toUpperCase().startsWith("A") ? "agent" : "human";
  const participantId = participantPart(rawParticipantId, "001");
  const model = participantType === "agent" ? labelPart(params.get("model"), "None") : "None";
  const requestedRunMode = params.get("run") ?? params.get("mode");
  const runMode: SessionRunMode = requestedRunMode === "ops" ? "ops" : "dev";
  const startedAtUtc = new Date().toISOString();
  const utc = startedAtUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return {
    sessionId: `${runMode}_${participantType}_${safePart(participantId)}_${utc}_${randomSuffix()}`,
    participantId,
    participantType,
    model,
    runMode,
  };
}
