import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  flattenFirestoreSession,
  parseArgs,
  toJsonSafe,
  writeSnapshot,
} from "./export_firestore.mjs";

test("parses required exporter options and repeatable filters", () => {
  assert.deepEqual(parseArgs([
    "--project", "vibe-9d6e5",
    "--output", "/tmp/export",
    "--session", "session-a",
    "--session", "session-b",
    "--task", "visual_similarity",
  ]), {
    project: "vibe-9d6e5",
    database: "(default)",
    output: "/tmp/export",
    sessions: ["session-a", "session-b"],
    task: "visual_similarity",
  });
  assert.throws(() => parseArgs(["--project", "vibe-9d6e5"]), /--output is required/);
  assert.throws(() => parseArgs(["--project", "vibe-9d6e5", "--output", "/tmp/export", "--unknown"]), /Unexpected argument/);
});

test("normalizes Firestore-like values without retaining SDK objects", () => {
  const reference = { path: "experimentSessions/session-a" };
  const timestamp = { toDate: () => new Date("2026-08-18T00:00:00.000Z") };
  const point = { latitude: 40.7, longitude: -74 };
  const bytes = { toUint8Array: () => Uint8Array.from([1, 2, 3]) };
  assert.deepEqual(toJsonSafe({ reference, timestamp, point, bytes }), {
    reference: "experimentSessions/session-a",
    timestamp: "2026-08-18T00:00:00.000Z",
    point: { latitude: 40.7, longitude: -74 },
    bytes: "AQID",
  });
});

test("flattens session and attaches session IDs to child records", () => {
  const result = flattenFirestoreSession(
    "session-a",
    { participantType: "human", model: "None", runMode: "dev" },
    [{ id: "result-a", data: { task: "visual_similarity", trialId: "1", correct: false } }],
    [{ id: "trajectory-a", data: { task: "visual_similarity", trialId: "1", points: [] } }],
  );
  assert.equal(result.session.sessionId, "session-a");
  assert.deepEqual(result.results, [{ sessionId: "session-a", resultId: "result-a", task: "visual_similarity", trialId: "1", correct: false }]);
  assert.deepEqual(result.trajectories, [{ sessionId: "session-a", trajectoryId: "trajectory-a", task: "visual_similarity", trialId: "1", points: [] }]);
});

test("flattens the production nested session metadata", () => {
  const result = flattenFirestoreSession(
    "session-a",
    {
      session: { participantId: "001", participantType: "agent", model: "google/gemini", runMode: "dev" },
      resultCount: 1,
      trajectoryCount: 0,
    },
    [],
    [],
  );
  assert.equal(result.session.participantType, "agent");
  assert.equal(result.session.participantId, "001");
  assert.equal(result.session.resultCount, 1);
  assert.equal("session" in result.session, false);
});

test("writes a portable snapshot with manifest counts", async () => {
  const output = await mkdtemp(join(tmpdir(), "firestore-export-test-"));
  await writeSnapshot({
    project: "vibe-9d6e5",
    database: "(default)",
    sessions: [{ sessionId: "session-a", participantType: "human" }],
    responses: [{ sessionId: "session-a", task: "visual_similarity", trialId: "1" }],
    trajectories: [],
  }, output);
  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.counts, { sessions: 1, responses: 1, trajectories: 0 });
  assert.equal(manifest.project, "vibe-9d6e5");
  assert.equal(JSON.stringify(manifest).includes("private_key"), false);
});
