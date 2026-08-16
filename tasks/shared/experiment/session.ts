import type { ObserverType, SessionIdentity, SessionRunMode } from "./types";

const safePart = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
const labelPart = (value: string | null, fallback: string) => value?.trim().slice(0, 120) || fallback;
const participantPart = (value: string | undefined, fallback: string) =>
  (value ?? fallback).toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;

const randomSuffix = () => crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(8, "0");

export function createSessionIdentity(search = window.location.search): SessionIdentity {
  const params = new URLSearchParams(search);
  const participantId = params.get("participant_id")?.trim() || undefined;
  const observerType: ObserverType = participantId?.toUpperCase().startsWith("A") ? "agent" : "human";
  const provider = observerType === "agent" ? labelPart(params.get("provider"), "unknown") : "local";
  const model = observerType === "agent" ? labelPart(params.get("model"), "unknown") : "human";
  const observer = observerType === "agent" ? safePart(params.get("agent_name") ?? "agent") : "human";
  const requestedRunMode = params.get("run") ?? params.get("mode");
  const runMode: SessionRunMode = requestedRunMode === "development" || requestedRunMode === "trace-smoke"
    ? requestedRunMode
    : "full";
  const startedAtUtc = new Date().toISOString();
  const utc = startedAtUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const runPrefix = runMode === "development" ? "development_" : runMode === "trace-smoke" ? "trace_" : "";
  const participant = participantPart(participantId, observerType === "agent" ? "A000" : "H000");
  return {
    sessionId: `${runPrefix}${participant}_${safePart(provider)}_${safePart(model)}_${utc}_${randomSuffix()}`,
    observerType,
    participantId,
    agentName: observerType === "agent" ? observer : undefined,
    agentProvider: observerType === "agent" ? provider : undefined,
    agentModel: observerType === "agent" ? model : undefined,
    runMode,
    startedAtUtc,
    randomSeed: crypto.getRandomValues(new Uint32Array(1))[0],
  };
}
