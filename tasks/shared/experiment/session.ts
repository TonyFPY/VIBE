import type { ObserverType, SessionIdentity, SessionRunMode } from "./types";

const safePart = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";

const randomSuffix = () => crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(8, "0");

export function createSessionIdentity(search = window.location.search): SessionIdentity {
  const params = new URLSearchParams(search);
  const observerType: ObserverType = params.get("observer") === "agent" ? "agent" : "human";
  const provider = observerType === "agent" ? safePart(params.get("provider") ?? "unknown") : "local";
  const model = observerType === "agent" ? safePart(params.get("model") ?? "unknown") : "human";
  const observer = observerType === "agent" ? safePart(params.get("agent_name") ?? "agent") : "human";
  const requestedRunMode = params.get("run") ?? params.get("mode");
  const runMode: SessionRunMode = requestedRunMode === "development" || requestedRunMode === "trace-smoke"
    ? requestedRunMode
    : "full";
  const startedAtUtc = new Date().toISOString();
  const utc = startedAtUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const runPrefix = runMode === "development" ? "development_" : runMode === "trace-smoke" ? "trace_" : "";
  return {
    sessionId: `${runPrefix}${observer}_${provider}_${model}_${utc}_${randomSuffix()}`,
    observerType,
    participantId: params.get("participant_id") ?? undefined,
    agentName: observerType === "agent" ? observer : undefined,
    agentProvider: observerType === "agent" ? provider : undefined,
    agentModel: observerType === "agent" ? model : undefined,
    runMode,
    startedAtUtc,
    randomSeed: crypto.getRandomValues(new Uint32Array(1))[0],
  };
}
