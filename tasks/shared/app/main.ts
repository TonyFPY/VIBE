import { initJsPsych } from "jspsych";
import "jspsych/css/jspsych.css";

import { createSessionIdentity } from "../experiment/session";
import { clearRecovery, saveRecovery, submitSession } from "../experiment/persistence";
import { isRecordedPhase, type ExperimentTrialResult, type ObjectMatchingTrialResult, type SessionPayload, type TrajectoryPoint, type TrialResult } from "../experiment/types";
import {
  ObjectMatchingInstructionPlugin,
  ObjectMatchingPlugin,
  ObjectMatchingTestReadyPlugin,
} from "../../object_matching/renderer";
import {
  ObjectMatchingPreloadBuffer,
  parseObjectMatchingCsv,
  selectObjectMatchingRunPhases,
  splitObjectMatchingPhases,
  type ObjectMatchingTrial,
} from "../../object_matching/task";
import { InstructionPlugin, TestReadyPlugin, VisualSimilarityPlugin } from "../../visual_similarity/renderer";
import { parseDreamSimCsv, selectRunPhases, splitExperimentPhases, TripletPreloadBuffer, type DreamSimTrial } from "../../visual_similarity/task";
import "./styles.css";

const root = document.querySelector<HTMLElement>("#app")!;
const identity = createSessionIdentity();
const runMode = new URLSearchParams(window.location.search).get("mode") === "development" ? "development" : "full";
const isObjectMatchingRoute = window.location.pathname === "/tasks/object-matching";
document.title = isObjectMatchingRoute ? "Object Matching" : "Visual Similarity";
const results: ExperimentTrialResult[] = [];
const trajectories: TrajectoryPoint[] = [];

function payload(): SessionPayload { return { session: identity, results, trajectories }; }
function checkpoint(): void { saveRecovery(payload()); }

function showError(message: string): void {
  root.innerHTML = `<section class="vs-card"><p class="vs-eyebrow">Unable to start</p><h1>Experiment unavailable</h1><p>${message}</p></section>`;
}

function download(name: string, contents: unknown): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(contents, null, 2)], { type: "application/json" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function finish(): Promise<void> {
  root.innerHTML = `<section class="vs-card"><p class="vs-eyebrow">Finalizing</p><h1>Saving your results…</h1><p>Please do not close this window.</p></section>`;
  checkpoint();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await submitSession(payload());
      clearRecovery(identity.sessionId);
      root.innerHTML = `<section class="vs-card"><p class="vs-eyebrow">Complete</p><h1>Results saved successfully.</h1><p>This window will close automatically.</p></section>`;
      window.setTimeout(() => window.close(), 900);
      return;
    } catch {
      await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  root.innerHTML = `<section class="vs-card"><p class="vs-eyebrow">Save incomplete</p><h1>We are still saving your results.</h1><p>Your run remains safely stored in this browser. Download recovery copies or keep this window open and retry later.</p><div class="vs-actions"><button id="download-results" class="vs-primary">Download results</button><button id="download-trajectories" class="vs-secondary">Download trajectories</button></div></section>`;
  document.querySelector("#download-results")?.addEventListener("click", () => download(`results/${identity.sessionId}.json`, { session: identity, results }));
  document.querySelector("#download-trajectories")?.addEventListener("click", () => download(`trajectories/${identity.sessionId}.json`, { session: identity, trajectories }));
}

function timelineFor(phase: "training" | "testing", trials: DreamSimTrial[]) {
  const buffer = new TripletPreloadBuffer(trials, 5);
  return trials.map((trial, index) => ({
    type: VisualSimilarityPlugin,
    trial,
    phase,
    trialNumber: index + 1,
    totalInPhase: trials.length,
    prepare: () => buffer.prepare(index),
    onComplete: (result: TrialResult, points: TrajectoryPoint[]) => {
      if (!isRecordedPhase(result.phase)) return;
      results.push(result);
      trajectories.push(...points);
      checkpoint();
    },
  }));
}

function objectMatchingTimelineFor(phase: "training" | "testing", trials: ObjectMatchingTrial[]) {
  const buffer = new ObjectMatchingPreloadBuffer(trials, 3);
  return trials.map((trial, index) => ({
    type: ObjectMatchingPlugin,
    trial,
    phase,
    trialNumber: index + 1,
    totalInPhase: trials.length,
    prepare: () => buffer.prepare(index),
    onComplete: (result: ObjectMatchingTrialResult, points: TrajectoryPoint[]) => {
      if (!isRecordedPhase(result.phase)) return;
      results.push(result);
      trajectories.push(...points);
      checkpoint();
    },
  }));
}

async function startVisualSimilarity(): Promise<void> {
  const response = await fetch("/data/dreamsim_100/data_100_web.csv");
  if (!response.ok) throw new Error("The trial dataset could not be loaded.");
  const phases = selectRunPhases(splitExperimentPhases(parseDreamSimCsv(await response.text())), runMode);
  const jsPsych = initJsPsych({ display_element: root, on_finish: () => void finish() });
  jsPsych.run([
    { type: InstructionPlugin },
    ...timelineFor("training", phases.training),
    { type: TestReadyPlugin },
    ...timelineFor("testing", phases.testing),
  ]);
}

async function startObjectMatching(): Promise<void> {
  const response = await fetch("/data/rs_imagenet_100/data_web_100.csv");
  if (!response.ok) throw new Error("The object-matching trial dataset could not be loaded.");
  const phases = selectObjectMatchingRunPhases(
    splitObjectMatchingPhases(parseObjectMatchingCsv(await response.text())),
    runMode,
  );
  const jsPsych = initJsPsych({ display_element: root, on_finish: () => void finish() });
  jsPsych.run([
    { type: ObjectMatchingInstructionPlugin },
    ...objectMatchingTimelineFor("training", phases.training),
    { type: ObjectMatchingTestReadyPlugin },
    ...objectMatchingTimelineFor("testing", phases.testing),
  ]);
}

const start = isObjectMatchingRoute
  ? startObjectMatching
  : startVisualSimilarity;

void start().catch((error: unknown) => showError(error instanceof Error ? error.message : "Unexpected startup failure."));
