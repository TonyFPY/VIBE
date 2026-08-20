import { initJsPsych } from "jspsych";
import "jspsych/css/jspsych.css";

import { parseLaunch } from "./launch";
import { createSessionIdentity } from "../experiment/session";
import { resultsEndpoint, saveRecovery } from "../experiment/persistence";
import { isRecordedPhase, type ExperimentTrialResult, type ObjectMatchingTrialResult, type SessionPayload, type TrialResult, type TrialTrajectory } from "../experiment/types";
import { finishSession } from "./save-flow";
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
  type ObjectMatchingRunMode,
  type ObjectMatchingTrial,
} from "../../object_matching/task";
import { InstructionPlugin, TestReadyPlugin, VisualSimilarityPlugin } from "../../visual_similarity/renderer";
import {
  parseDreamSimCsv,
  selectRunPhases,
  splitExperimentPhases,
  TripletPreloadBuffer,
  type DreamSimTrial,
  type RunMode,
} from "../../visual_similarity/task";
import "./styles.css";

const root = document.querySelector<HTMLElement>("#app")!;
const identity = createSessionIdentity();
const results: ExperimentTrialResult[] = [];
const trajectories: TrialTrajectory[] = [];

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

async function finish(runMode: RunMode): Promise<void> {
  await finishSession({
    root,
    payload: payload(),
    endpoint: resultsEndpoint(undefined, runMode),
    checkpoint,
    download,
    closeWindow: () => window.setTimeout(() => window.close(), 900),
  });
}

function timelineFor(phase: "training" | "testing", trials: DreamSimTrial[]) {
  const buffer = new TripletPreloadBuffer(trials, 3);
  return trials.map((trial, index) => ({
    type: VisualSimilarityPlugin,
    trial,
    phase,
    trialNumber: index + 1,
    totalInPhase: trials.length,
    prepare: () => buffer.prepare(index),
    onComplete: (result: TrialResult, points: TrialTrajectory[]) => {
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
    onComplete: (result: ObjectMatchingTrialResult, points: TrialTrajectory[]) => {
      if (!isRecordedPhase(result.phase)) return;
      results.push(result);
      trajectories.push(...points);
      checkpoint();
    },
  }));
}

async function startVisualSimilarity(runMode: RunMode): Promise<void> {
  const response = await fetch("/data/dreamsim_100/data_100_web.csv");
  if (!response.ok) throw new Error("The trial dataset could not be loaded.");
  const phases = selectRunPhases(
    splitExperimentPhases(parseDreamSimCsv(await response.text())),
    runMode,
    `${identity.sessionId}:visual-similarity`,
  );
  const jsPsych = initJsPsych({ display_element: root, on_finish: () => void finish(runMode) });
  jsPsych.run([
    { type: InstructionPlugin },
    ...timelineFor("training", phases.training),
    { type: TestReadyPlugin },
    ...timelineFor("testing", phases.testing),
  ]);
}

async function startObjectMatching(runMode: ObjectMatchingRunMode): Promise<void> {
  const response = await fetch("/data/rs_imagenet_100/data_web_100.csv");
  if (!response.ok) throw new Error("The object-matching trial dataset could not be loaded.");
  const phases = selectObjectMatchingRunPhases(
    splitObjectMatchingPhases(parseObjectMatchingCsv(await response.text())),
    runMode,
    `${identity.sessionId}:object-matching`,
  );
  const jsPsych = initJsPsych({ display_element: root, on_finish: () => void finish(runMode) });
  jsPsych.run([
    { type: ObjectMatchingInstructionPlugin },
    ...objectMatchingTimelineFor("training", phases.training),
    { type: ObjectMatchingTestReadyPlugin },
    ...objectMatchingTimelineFor("testing", phases.testing),
  ]);
}

async function start(): Promise<void> {
  const launch = parseLaunch(window.location.pathname, window.location.search);
  if (launch.task === "object-matching") {
    document.title = "Object Matching";
    await startObjectMatching(launch.runMode);
    return;
  }
  document.title = "Visual Similarity";
  await startVisualSimilarity(launch.runMode);
}

void start().catch((error: unknown) => showError(error instanceof Error ? error.message : "Unexpected startup failure."));
