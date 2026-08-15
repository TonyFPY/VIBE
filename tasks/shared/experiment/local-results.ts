import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LocalResultFiles {
  responsePath: string;
  trajectoryPath: string;
}

const knownTasks = new Set(["visual_similarity", "object_matching"]);
const safeSessionId = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function persistLocalSession(payload: unknown, resultsRoot: string): LocalResultFiles {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Session payload must be an object");
  }
  const sessionPayload = payload as Record<string, unknown>;
  const session = sessionPayload.session;
  const results = sessionPayload.results;
  const trajectories = sessionPayload.trajectories;
  if (typeof session !== "object" || session === null || Array.isArray(session)) {
    throw new Error("Session payload must include session metadata");
  }
  const sessionId = (session as Record<string, unknown>).sessionId;
  if (typeof sessionId !== "string" || !safeSessionId.test(sessionId)) {
    throw new Error("Session payload must include a safe session ID");
  }
  if (!Array.isArray(results) || !Array.isArray(trajectories)) {
    throw new Error("Session payload must include results and trajectories arrays");
  }
  const task = results[0] && typeof results[0] === "object"
    ? (results[0] as Record<string, unknown>).task
    : undefined;
  if (typeof task !== "string" || !knownTasks.has(task)) {
    throw new Error("Session payload must include a known task result");
  }

  const responsePath = join(resultsRoot, "response", task, `results_${sessionId}.json`);
  const trajectoryPath = join(resultsRoot, "trajectory", task, `trajectories_${sessionId}.json`);
  mkdirSync(join(resultsRoot, "response", task), { recursive: true });
  mkdirSync(join(resultsRoot, "trajectory", task), { recursive: true });
  writeFileSync(responsePath, JSON.stringify({ session, results }, null, 2));
  writeFileSync(trajectoryPath, JSON.stringify({ session, trajectories }, null, 2));
  return { responsePath, trajectoryPath };
}
