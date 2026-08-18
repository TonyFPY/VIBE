#!/usr/bin/env node

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import process from "node:process";

const requireFromFunctions = createRequire(new URL("../../functions/package.json", import.meta.url));
const adminApp = requireFromFunctions("firebase-admin/app");
const adminFirestore = requireFromFunctions("firebase-admin/firestore");

const { applicationDefault, getApps, initializeApp } = adminApp;
const { getFirestore } = adminFirestore;
const SCHEMA_VERSION = 1;
const KNOWN_TASKS = new Set(["visual_similarity", "object_matching"]);

export function parseArgs(argv) {
  let project;
  let database = "(default)";
  let output;
  let task;
  const sessions = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--project") {
      if (!value || value.startsWith("--")) throw new Error("--project requires a project ID");
      project = value;
      index += 1;
    } else if (argument === "--database") {
      if (!value || value.startsWith("--")) throw new Error("--database requires a database ID");
      database = value;
      index += 1;
    } else if (argument === "--output") {
      if (!value || value.startsWith("--")) throw new Error("--output requires a folder");
      output = value;
      index += 1;
    } else if (argument === "--session") {
      if (!value || value.startsWith("--")) throw new Error("--session requires a session ID");
      sessions.push(value);
      index += 1;
    } else if (argument === "--task") {
      if (!value || value.startsWith("--")) throw new Error("--task requires a supported task name");
      if (!KNOWN_TASKS.has(value)) throw new Error(`--task must be ${[...KNOWN_TASKS].join(" or ")}`);
      task = value;
      index += 1;
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }

  if (!project) throw new Error("--project is required");
  if (!output) throw new Error("--output is required");
  return { project, database, output, sessions, task };
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toJsonSafe(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  if (value && typeof value.toUint8Array === "function") {
    return Buffer.from(value.toUint8Array()).toString("base64");
  }
  if (value && typeof value.path === "string" && typeof value.get !== "function") return value.path;
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item, seen));
  if (isPlainObject(value)) {
    if (seen.has(value)) throw new Error("Cannot serialize a cyclic Firestore value");
    seen.add(value);
    const output = {};
    for (const [key, child] of Object.entries(value)) output[key] = toJsonSafe(child, seen);
    seen.delete(value);
    return output;
  }
  return String(value);
}

export function flattenFirestoreSession(sessionId, sessionData, resultDocs, trajectoryDocs) {
  const safeSession = toJsonSafe(sessionData);
  const nestedSession = isPlainObject(safeSession) && isPlainObject(safeSession.session)
    ? safeSession.session
    : {};
  const documentFields = isPlainObject(safeSession) ? {...safeSession} : {};
  delete documentFields.session;
  const session = {
    ...documentFields,
    ...nestedSession,
    sessionId,
  };
  const flattenChild = (child, key) => {
    const safeData = toJsonSafe(child.data);
    return {
      sessionId,
      [key]: child.id,
      ...(isPlainObject(safeData) ? safeData : {}),
    };
  };
  return {
    session,
    results: resultDocs.map((child) => flattenChild(child, "resultId")),
    trajectories: trajectoryDocs.map((child) => flattenChild(child, "trajectoryId")),
  };
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function writeSnapshot(snapshot, outputDir) {
  const output = resolve(outputDir);
  await mkdir(output, { recursive: true });
  const exportedAt = new Date().toISOString();
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    project: snapshot.project,
    database: snapshot.database,
    counts: {
      sessions: snapshot.sessions.length,
      responses: snapshot.responses.length,
      trajectories: snapshot.trajectories.length,
    },
  };
  await writeJsonAtomic(resolve(output, "sessions.json"), snapshot.sessions);
  await writeJsonAtomic(resolve(output, "responses.json"), snapshot.responses);
  await writeJsonAtomic(resolve(output, "trajectories.json"), snapshot.trajectories);
  await writeJsonAtomic(resolve(output, "manifest.json"), manifest);
  return manifest;
}

function appForProject(project) {
  if (getApps().length > 0) return getApps()[0];
  return initializeApp({ credential: applicationDefault(), projectId: project }, `results-export-${Date.now()}`);
}

async function readFirestoreSnapshot(options) {
  const db = getFirestore(appForProject(options.project), options.database);
  const sessionSnapshot = await db.collection("experimentSessions").get();
  const sessions = [];
  const responses = [];
  const trajectories = [];
  const sessionFilter = new Set(options.sessions);

  for (const sessionDocument of sessionSnapshot.docs) {
    if (sessionFilter.size > 0 && !sessionFilter.has(sessionDocument.id)) continue;
    const resultSnapshot = await sessionDocument.ref.collection("results").get();
    const trajectorySnapshot = await sessionDocument.ref.collection("trajectories").get();
    const flattened = flattenFirestoreSession(
      sessionDocument.id,
      sessionDocument.data(),
      resultSnapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
      trajectorySnapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
    );
    const matchingResponses = options.task
      ? flattened.results.filter((result) => result.task === options.task)
      : flattened.results;
    if (options.task && matchingResponses.length === 0) continue;
    sessions.push(flattened.session);
    responses.push(...matchingResponses);
    trajectories.push(...(options.task
      ? flattened.trajectories.filter((trajectory) => trajectory.task === options.task)
      : flattened.trajectories));
  }

  return { project: options.project, database: options.database, sessions, responses, trajectories };
}

export function usage() {
  return [
    "Usage: node results/scripts/export_firestore.mjs --project <project-id> --output <folder> [options]",
    "Options:",
    "  --database <database-id>  Firestore database (default: (default))",
    "  --session <session-id>    Limit export; may be repeated",
    "  --task <task>             visual_similarity or object_matching",
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help")) {
    console.log(usage());
    return 0;
  }
  try {
    const options = parseArgs(argv);
    const snapshot = await readFirestoreSnapshot(options);
    const manifest = await writeSnapshot(snapshot, options.output);
    console.log(JSON.stringify({ output: resolve(options.output), ...manifest }));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Firestore export failed");
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
