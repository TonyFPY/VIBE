import {createHash} from "node:crypto";
import {initializeApp} from "firebase-admin/app";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import type {Request, Response} from "express";
import {normalizeTrajectoryForFirestore, validateSessionPayload} from "./validation";

initializeApp();
const db = getFirestore();
const maxBodyBytes = 2_000_000;
const allowedOrigin = process.env.ALLOWED_ORIGIN?.trim();

setGlobalOptions({region: "us-east1", maxInstances: 10});

function setCors(request: Request, response: Response): boolean {
  const origin = request.get("origin");
  if (allowedOrigin && origin && origin !== allowedOrigin) return false;
  response.set("Access-Control-Allow-Origin", allowedOrigin || "*");
  response.set("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Vary", "Origin");
  return true;
}

function bodySize(payload: unknown): number {
  const serialized = JSON.stringify(payload);
  return serialized === undefined ? 0 : Buffer.byteLength(serialized);
}

function stableDocumentId(value: string, index: number): string {
  const safeValue = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 96) || "record";
  return `${index}-${safeValue}`;
}

function isAlreadyExists(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = (error as {code?: unknown}).code;
  return code === 6 || code === "6" || code === "ALREADY_EXISTS";
}

export const saveSession = onRequest(
  {region: "us-east1", timeoutSeconds: 30, memory: "256MiB", maxInstances: 10},
  async (request, response) => {
    if (!setCors(request, response)) {
      response.status(403).json({error: "Origin is not allowed"});
      return;
    }
    if (request.method === "OPTIONS") {
      response.status(204).send("");
      return;
    }
    if (request.method !== "POST") {
      response.set("Allow", "POST, OPTIONS").status(405).json({error: "Only POST is supported"});
      return;
    }

    const rawPayload = request.body;
    if (Number(request.get("content-length") || 0) > maxBodyBytes || bodySize(rawPayload) > maxBodyBytes) {
      response.status(413).json({error: "Session payload is too large"});
      return;
    }

    const idempotencyKey = request.get("Idempotency-Key")?.trim();
    if (!idempotencyKey) {
      response.status(400).json({error: "Idempotency-Key is required"});
      return;
    }

    let validated;
    try {
      validated = validateSessionPayload(rawPayload, idempotencyKey);
    } catch (error) {
      response.status(400).json({error: error instanceof Error ? error.message : "Invalid session payload"});
      return;
    }

    const payloadHash = createHash("sha256")
      .update(JSON.stringify({session: validated.session, results: validated.results, trajectories: validated.trajectories}))
      .digest("hex");
    const sessionId = validated.session.sessionId as string;
    const sessionRef = db.collection("experimentSessions").doc(sessionId);
    const batch = db.batch();

    batch.create(sessionRef, {
      session: validated.session,
      payloadHash,
      resultCount: validated.results.length,
      trajectoryCount: validated.trajectories.length,
      writeCount: validated.writeCount,
      savedAt: FieldValue.serverTimestamp(),
    });
    validated.results.forEach((result, index) => {
      const resultRef = sessionRef.collection("results").doc(stableDocumentId(result.trialId as string, index));
      batch.create(resultRef, result);
    });
    validated.trajectories.forEach((trajectory, index) => {
      const trajectoryRef = sessionRef.collection("trajectories").doc(stableDocumentId(trajectory.trialId as string, index));
      batch.create(trajectoryRef, normalizeTrajectoryForFirestore(trajectory));
    });

    try {
      await batch.commit();
      logger.info("Experiment session saved", {
        sessionId,
        resultCount: validated.results.length,
        trajectoryCount: validated.trajectories.length,
      });
      response.status(201).json({ok: true, sessionId});
    } catch (error) {
      if (isAlreadyExists(error)) {
        const existing = await sessionRef.get();
        if (existing.data()?.payloadHash === payloadHash) {
          response.status(200).json({ok: true, duplicate: true, sessionId});
          return;
        }
        response.status(409).json({error: "Session ID already contains different data"});
        return;
      }
      logger.error("Experiment session save failed", {sessionId, error});
      response.status(500).json({error: "Unable to save experiment session"});
    }
  },
);
