import { ParameterType, type JsPsych } from "jspsych";

import { calculateReactionTimeMs, isTrialViewportSupported, normalizePointer, TRIAL_CANVAS } from "../shared/experiment/geometry";
import type { ObjectMatchingTrialResult, TrajectoryPoint } from "../shared/experiment/types";
import {
  objectMatchingFeedback,
  scoreObjectMatchingResponse,
  toPublicObjectMatchingTrial,
  type ObjectMatchingTrial,
} from "./task";

type Phase = "training" | "testing";

export interface ObjectMatchingTrialParameters {
  trial: ObjectMatchingTrial;
  phase: Phase;
  trialNumber: number;
  totalInPhase: number;
  prepare: () => Promise<void>;
  onComplete: (result: ObjectMatchingTrialResult, trajectory: TrajectoryPoint[]) => void;
}

export class ObjectMatchingInstructionPlugin {
  static info = { name: "object-matching-instructions", version: "1.0.0", parameters: {}, data: {} };

  constructor(private readonly jsPsych: JsPsych) {}

  trial(displayElement: HTMLElement): void {
    displayElement.innerHTML = `
      <section class="vs-card vs-instructions">
        <p class="vs-eyebrow">Object matching</p>
        <h2>Which object belongs with the reference?</h2>
        <p>Click the center cross to start each trial.</p>
        <p>Choose and click one image around the centered reference.</p>
        <p>You will start with some training trials. </p>
        <p>Please do not refresh or close this window.</p>
        <button class="vs-primary" type="button">Start</button>
      </section>`;
    displayElement.querySelector("button")?.addEventListener("click", () => this.jsPsych.finishTrial());
  }
}

export class ObjectMatchingTestReadyPlugin {
  static info = { name: "object-matching-test-ready", version: "1.0.0", parameters: {}, data: {} };

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

export class ObjectMatchingPlugin {
  static info = {
    name: "object-matching-8afc",
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

  trial(displayElement: HTMLElement, parameters: ObjectMatchingTrialParameters): void {
    if (!isTrialViewportSupported({ width: window.innerWidth, height: window.innerHeight })) {
      displayElement.innerHTML = `<section class="vs-viewport-required" role="alert"><h1>Window too small</h1><p>This task requires a browser viewport of at least ${TRIAL_CANVAS.width} × ${TRIAL_CANVAS.height} pixels. Maximize the window or use a larger display, then refresh.</p></section>`;
      return;
    }
    displayElement.innerHTML = `<section class="vs-loading" aria-live="polite">Preparing trial…</section>`;
    void this.prepareTrial(displayElement, parameters);
  }

  private async prepareTrial(displayElement: HTMLElement, parameters: ObjectMatchingTrialParameters): Promise<void> {
    const prefetchStartedAt = performance.now();
    try {
      await parameters.prepare();
    } catch {
      displayElement.innerHTML = `<section class="vs-loading" role="alert">Unable to prepare this trial. Please refresh and try again.</section>`;
      return;
    }
    const prefetchCompletedAt = performance.now();
    const readyAt = performance.now();
    const progress = `${parameters.phase === "training" ? "Training" : "Testing"} ${parameters.trialNumber} / ${parameters.totalInPhase}`;
    displayElement.innerHTML = `
      <section class="vs-trial" aria-label="${progress}">
        <div class="vs-progress"><span>${progress}</span><div><i style="width:${(parameters.trialNumber - 1) / parameters.totalInPhase * 100}%"></i></div></div>
        <div class="om-cross-slot"><button class="om-cross" type="button" aria-label="Begin trial">+</button></div>
      </section>`;
    const crossShownAt = performance.now();
    displayElement.querySelector<HTMLButtonElement>(".om-cross")?.addEventListener("click", (event) => {
      this.showStimuli(displayElement, parameters, {
        readyAt,
        crossShownAt,
        crossClickedAt: performance.now(),
        crossClickX: event.clientX,
        crossClickY: event.clientY,
        prefetchStartedAt,
        prefetchCompletedAt,
      });
    }, { once: true });
  }

  private showStimuli(
    displayElement: HTMLElement,
    parameters: ObjectMatchingTrialParameters,
    timing: {
      readyAt: number; crossShownAt: number; crossClickedAt: number; crossClickX: number; crossClickY: number;
      prefetchStartedAt: number; prefetchCompletedAt: number;
    },
  ): void {
    const publicTrial = toPublicObjectMatchingTrial(parameters.trial);
    const stimulusShownAt = performance.now();
    const candidateMarkup = publicTrial.candidates.map((source, label) => `
      <div class="om-stimulus-item om-option-${label}">
        <button type="button" class="om-candidate om-image-frame" data-label="${label}" aria-label="Choose option ${label}"><img src="${source}" alt="Option ${label}" /></button>
      </div>`);
    const referenceMarkup = `<figure class="om-stimulus-item om-reference"><div class="om-image-frame"><img src="${publicTrial.referenceImage}" alt="Reference image" /></div><figcaption class="om-stimulus-label">reference</figcaption></figure>`;
    const candidateBeforeReference = candidateMarkup.slice(0, 4).join("");
    const candidateAfterReference = candidateMarkup.slice(4).join("");
    displayElement.innerHTML = `
      <section class="vs-trial" aria-label="Object matching trial">
        <div class="vs-progress"><span>${parameters.phase === "training" ? "Training" : "Testing"} ${parameters.trialNumber} / ${parameters.totalInPhase}</span><div><i style="width:${parameters.trialNumber / parameters.totalInPhase * 100}%"></i></div></div>
        <div class="om-stimulus-grid">
          ${candidateBeforeReference}${referenceMarkup}${candidateAfterReference}
        </div>
      </section>`;

    const trialArea = displayElement.querySelector<HTMLElement>(".vs-trial")!;
    const trajectories: TrajectoryPoint[] = [];
    const onPointerMove = (event: PointerEvent) => {
      if (parameters.phase !== "testing") return;
      const rectangle = trialArea.getBoundingClientRect();
      trajectories.push({
        trialId: parameters.trial.id,
        sampleIndex: trajectories.length,
        timestamp: performance.now(),
        elapsedMsFromCrossClick: performance.now() - timing.crossClickedAt,
        ...normalizePointer({ x: event.clientX, y: event.clientY }, rectangle),
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
    const finish = (event: MouseEvent, selectedLabel: number) => {
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
      const result: ObjectMatchingTrialResult = {
        task: "object_matching",
        trialId: parameters.trial.id,
        phase: parameters.phase,
        csvRowIndex: parameters.trial.csvRowIndex,
        sourceId: parameters.trial.id,
        className: parameters.trial.className,
        referenceImage: parameters.trial.referenceImage,
        candidates: parameters.trial.candidates,
        correctLabel: parameters.trial.correctLabel,
        selectedLabel,
        correct: scoreObjectMatchingResponse(selectedLabel, parameters.trial.correctLabel),
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
        const feedback = objectMatchingFeedback(result.correct);
        displayElement.innerHTML = `<section class="vs-feedback ${feedback.className}">${feedback.text}</section>`;
        this.jsPsych.pluginAPI.setTimeout(() => this.jsPsych.finishTrial(), feedback.durationMs);
      } else {
        this.jsPsych.finishTrial();
      }
    };
    displayElement.querySelectorAll<HTMLButtonElement>(".om-candidate").forEach((button) => {
      button.addEventListener("click", (event) => finish(event, Number(button.dataset.label)), { once: true });
    });
  }
}
