export type JsonObject = Record<string, unknown>;

export interface ValidatedSessionPayload {
  session: JsonObject;
  results: JsonObject[];
  trajectories: JsonObject[];
  writeCount: number;
}

const knownTasks = new Set(["visual_similarity", "object_matching"]);
const safeSessionId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const maxRecords = 200;
const maxTrajectoryPoints = 5_000;
const maxFirestoreWrites = 500;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

export function validateSessionPayload(payload: unknown, idempotencyKey: string): ValidatedSessionPayload {
  if (!isObject(payload)) throw new Error("Session payload must be an object");
  if (!isObject(payload.session)) throw new Error("Session payload must include session metadata");
  if (!Array.isArray(payload.results) || !Array.isArray(payload.trajectories)) {
    throw new Error("Session payload must include results and trajectories arrays");
  }

  const sessionId = requireString(payload.session.sessionId, "sessionId");
  if (!safeSessionId.test(sessionId)) throw new Error("sessionId must be filesystem-safe");
  if (idempotencyKey !== sessionId) throw new Error("Idempotency-Key must match sessionId");
  if (payload.session.observerType !== "human" && payload.session.observerType !== "agent") {
    throw new Error("observerType must be human or agent");
  }
  requireString(payload.session.startedAtUtc, "startedAtUtc");
  if (typeof payload.session.randomSeed !== "number" || !Number.isFinite(payload.session.randomSeed)) {
    throw new Error("randomSeed must be a finite number");
  }

  if (payload.results.length === 0 || payload.results.length > maxRecords) {
    throw new Error(`results must contain between 1 and ${maxRecords} records`);
  }
  if (payload.trajectories.length > maxRecords) {
    throw new Error(`trajectories must contain at most ${maxRecords} records`);
  }

  for (const result of payload.results) {
    if (!isObject(result)) throw new Error("Each result must be an object");
    const task = requireString(result.task, "result.task");
    if (!knownTasks.has(task)) throw new Error("results must contain a known task");
    requireString(result.trialId, "result.trialId");
  }

  for (const trajectory of payload.trajectories) {
    if (!isObject(trajectory)) throw new Error("Each trajectory must be an object");
    requireString(trajectory.trialId, "trajectory.trialId");
    if (!Array.isArray(trajectory.points) || trajectory.points.length > maxTrajectoryPoints) {
      throw new Error(`trajectory points must contain at most ${maxTrajectoryPoints} samples`);
    }
    for (const point of trajectory.points) {
      if (!Array.isArray(point) || point.length !== 3 || point.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
        throw new Error("Each trajectory point must contain three finite numbers");
      }
    }
  }

  const writeCount = 1 + payload.results.length + payload.trajectories.length;
  if (writeCount > maxFirestoreWrites) {
    throw new Error(`Session is too large to save atomically; maximum writes are ${maxFirestoreWrites}`);
  }

  return {
    session: payload.session,
    results: payload.results,
    trajectories: payload.trajectories,
    writeCount,
  };
}
