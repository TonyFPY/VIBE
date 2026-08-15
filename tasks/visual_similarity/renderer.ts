import { ParameterType, type JsPsych } from "jspsych";

import { isTrialViewportSupported, normalizePointer, scoreResponse, toPublicTrial, trainingAlignmentFeedback, trainingAlignmentFeedbackDuration, TRIAL_CANVAS, type DreamSimTrial } from "./task";
import { calculateReactionTimeMs } from "../shared/experiment/geometry";
import type { Side, TrajectoryPoint, TrialResult } from "../shared/experiment/types";

type Phase = "training" | "testing";

export interface VisualTrialParameters {
  trial: DreamSimTrial;
  phase: Phase;
  trialNumber: number;
  totalInPhase: number;
  prepare: () => Promise<void>;
  onComplete: (result: TrialResult, trajectory: TrajectoryPoint[]) => void;
}

export class InstructionPlugin {
  static info = {
    name: "visual-similarity-instructions",
    version: "1.0.0",
    parameters: {},
    data: {},
  };

  constructor(private readonly jsPsych: JsPsych) {}

  trial(displayElement: HTMLElement): void {
    displayElement.innerHTML = `
      <section class="vs-card vs-instructions">
        <p class="vs-eyebrow">Visual similarity</p>
        <h2>Which image is most similar to the reference?</h2>
        <p>Each trial begins at the center cross. Click it to start each trial.</p>
        <p>Compare and choose left or right by clicking the image.</p>
        <p>You will start with some training trials.</p>
        <p>Please do not refresh or close this window.</p>
        <button class="vs-primary" type="button">Start</button>
      </section>`;
    displayElement.querySelector("button")?.addEventListener("click", () => this.jsPsych.finishTrial());
  }
}

export class TestReadyPlugin {
  static info = {
    name: "visual-similarity-test-ready",
    version: "1.0.0",
    parameters: {},
    data: {},
  };

  constructor(private readonly jsPsych: JsPsych) {}

  trial(displayElement: HTMLElement): void {
    displayElement.innerHTML = `
      <section class="vs-card vs-instructions">
        <p class="vs-eyebrow">Testing phase</p>
        <h2>Are you ready for the real test?</h2>
        <p>You will now complete the main trials.</p>
        <p>Feedback will no longer be shown.</p>
        <button class="vs-primary" type="button">Continue</button>
      </section>`;
    displayElement.querySelector("button")?.addEventListener("click", () => this.jsPsych.finishTrial());
  }
}

export class VisualSimilarityPlugin {
  static info = {
    name: "visual-similarity-2afc",
    version: "1.0.0",
    parameters: {
      trial: { type: ParameterType.OBJECT, default: undefined },
      phase: { type: ParameterType.STRING, default: undefined },
      trialNumber: { type: ParameterType.INT, default: undefined },
      totalInPhase: { type: ParameterType.INT, default: undefined },
      prepare: { type: ParameterType.FUNCTION, default: undefined },
      onComplete: { type: ParameterType.FUNCTION, default: undefined },
    },
    data: {},
  };

  constructor(private readonly jsPsych: JsPsych) {}

  trial(displayElement: HTMLElement, parameters: VisualTrialParameters): void {
    if (!isTrialViewportSupported({ width: window.innerWidth, height: window.innerHeight })) {
      displayElement.innerHTML = `<section class="vs-viewport-required" role="alert"><h1>Window too small</h1><p>This task requires a browser viewport of at least ${TRIAL_CANVAS.width} × ${TRIAL_CANVAS.height} pixels. Maximize the window or use a larger display, then refresh.</p></section>`;
      return;
    }
    displayElement.innerHTML = `<section class="vs-loading" aria-live="polite">Preparing trial…</section>`;
    void this.prepareTrial(displayElement, parameters);
  }

  private async prepareTrial(displayElement: HTMLElement, parameters: VisualTrialParameters): Promise<void> {
    const prefetchStartedAt = performance.now();
    try {
      await parameters.prepare();
    } catch {
      displayElement.innerHTML = `<section class="vs-loading" role="alert">Unable to prepare this trial. Please refresh and try again.</section>`;
      return;
    }
    const prefetchCompletedAt = performance.now();
    const readyAt = performance.now();
    const publicTrial = toPublicTrial(parameters.trial);
    const progress = `${parameters.phase === "training" ? "Training" : "Testing"} ${parameters.trialNumber} / ${parameters.totalInPhase}`;
    let crossShownAt = performance.now();

    displayElement.innerHTML = `
      <section class="vs-trial" aria-label="${progress}">
        <div class="vs-progress"><span>${progress}</span><div><i style="width:${(parameters.trialNumber - 1) / parameters.totalInPhase * 100}%"></i></div></div>
        <div class="vs-cross-slot"><button class="vs-cross" type="button" aria-label="Begin trial">+</button></div>
      </section>`;
    const cross = displayElement.querySelector<HTMLButtonElement>(".vs-cross");
    cross?.addEventListener("click", (event) => {
      crossShownAt = crossShownAt || performance.now();
      this.showStimuli(displayElement, parameters, publicTrial, {
        readyAt, crossShownAt, crossClickedAt: performance.now(), crossClickX: event.clientX, crossClickY: event.clientY,
        prefetchStartedAt, prefetchCompletedAt,
      });
    }, { once: true });
  }

  private showStimuli(
    displayElement: HTMLElement,
    parameters: VisualTrialParameters,
    publicTrial: ReturnType<typeof toPublicTrial>,
    timing: { readyAt: number; crossShownAt: number; crossClickedAt: number; crossClickX: number; crossClickY: number; prefetchStartedAt: number; prefetchCompletedAt: number },
  ): void {
    const stimulusShownAt = performance.now();
    displayElement.innerHTML = `
      <section class="vs-trial vs-stimulus" aria-label="Visual similarity trial">
        <div class="vs-progress"><span>${parameters.phase === "training" ? "Training" : "Testing"} ${parameters.trialNumber} / ${parameters.totalInPhase}</span><div><i style="width:${parameters.trialNumber / parameters.totalInPhase * 100}%"></i></div></div>
        <div class="vs-stimulus-row">
          <div class="vs-stimulus-item"><button type="button" class="vs-candidate vs-image-frame" data-side="left" aria-label="Choose left candidate"><img src="${publicTrial.leftCandidate}" alt="Left candidate" /></button></div>
          <figure class="vs-stimulus-item vs-reference"><div class="vs-image-frame"><img src="${publicTrial.referenceImage}" alt="Reference image" /></div><figcaption class="vs-stimulus-label">reference</figcaption></figure>
          <div class="vs-stimulus-item"><button type="button" class="vs-candidate vs-image-frame" data-side="right" aria-label="Choose right candidate"><img src="${publicTrial.rightCandidate}" alt="Right candidate" /></button></div>
        </div>
      </section>`;

    const trialArea = displayElement.querySelector<HTMLElement>(".vs-trial")!;
    const trajectories: TrajectoryPoint[] = [];
    const onPointerMove = (event: PointerEvent) => {
      if (parameters.phase !== "testing") return;
      const rectangle = trialArea.getBoundingClientRect();
      const normalized = normalizePointer({ x: event.clientX, y: event.clientY }, rectangle);
      trajectories.push({
        trialId: parameters.trial.id,
        sampleIndex: trajectories.length,
        timestamp: performance.now(),
        elapsedMsFromCrossClick: performance.now() - timing.crossClickedAt,
        ...normalized,
      });
    };
    if (parameters.phase === "testing") {
      const rectangle = trialArea.getBoundingClientRect();
      trajectories.push({
        trialId: parameters.trial.id,
        sampleIndex: trajectories.length,
        timestamp: timing.crossClickedAt,
        elapsedMsFromCrossClick: 0,
        ...normalizePointer({ x: timing.crossClickX, y: timing.crossClickY }, rectangle),
      });
    }
    trialArea.addEventListener("pointermove", onPointerMove);

    let responded = false;
    const finish = (event: MouseEvent, selectedSide: Side) => {
      if (responded) return;
      responded = true;
      trialArea.removeEventListener("pointermove", onPointerMove);
      const responseAt = performance.now();
      if (parameters.phase === "testing") {
        const rectangle = trialArea.getBoundingClientRect();
        trajectories.push({
          trialId: parameters.trial.id,
          sampleIndex: trajectories.length,
          timestamp: responseAt,
          elapsedMsFromCrossClick: responseAt - timing.crossClickedAt,
          ...normalizePointer({ x: event.clientX, y: event.clientY }, rectangle),
        });
      }
      const result: TrialResult = {
        task: "visual_similarity",
        trialId: parameters.trial.id,
        phase: parameters.phase,
        csvRowIndex: parameters.trial.csvRowIndex,
        sourceId: parameters.trial.id,
        referenceImage: parameters.trial.referenceImage,
        leftCandidate: parameters.trial.leftCandidate,
        rightCandidate: parameters.trial.rightCandidate,
        correctSide: parameters.trial.correctSide,
        selectedSide,
        correct: scoreResponse(selectedSide, parameters.trial.correctSide),
        trialReadyAt: timing.readyAt,
        crossShownAt: timing.crossShownAt,
        crossClickedAt: timing.crossClickedAt,
        stimulusShownAt,
        responseAt,
        reactionTimeMs: calculateReactionTimeMs(timing.crossClickedAt, responseAt),
        responseX: event.clientX,
        responseY: event.clientY,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        prefetchStartedAt: timing.prefetchStartedAt,
        prefetchCompletedAt: timing.prefetchCompletedAt,
      };
      parameters.onComplete(result, trajectories);
      if (parameters.phase === "training") {
        displayElement.innerHTML = `<section class="vs-feedback ${result.correct ? "is-correct" : "is-incorrect"}">${trainingAlignmentFeedback(result.correct)}</section>`;
        this.jsPsych.pluginAPI.setTimeout(() => this.jsPsych.finishTrial(), trainingAlignmentFeedbackDuration(result.correct));
      } else {
        this.jsPsych.finishTrial();
      }
    };
    displayElement.querySelectorAll<HTMLButtonElement>(".vs-candidate").forEach((button) => {
      button.addEventListener("click", (event) => finish(event, button.dataset.side as Side), { once: true });
    });
  }
}
