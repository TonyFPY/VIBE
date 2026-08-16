// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  OBJECT_IMAGE_SIZE,
  OBJECT_STIMULUS_GRID,
  isObjectMatchingViewportSupported,
  parseObjectMatchingCsv,
  scoreObjectMatchingResponse,
  selectObjectMatchingRunPhases,
  splitObjectMatchingPhases,
  toPublicObjectMatchingTrial,
  objectMatchingFeedback,
} from "../task";
import { ObjectMatchingPlugin } from "../renderer";
import { isRecordedPhase } from "../../shared/experiment/types";

const header = "trial_id,class_name,reference,candidate_0,candidate_1,candidate_2,candidate_3,candidate_4,candidate_5,candidate_6,candidate_7,correct_label";
const row = (id: number, correctLabel = 4) => [
  id, "frog", `reference/frog/${id}.jpg`,
  ...Array.from({ length: 8 }, (_, index) => `distractor/item-${id}-${index}.jpg`),
  correctLabel,
].join(",");

describe("object matching task", () => {
  it("parses the eight candidate paths and preserves the private correct label", () => {
    const [trial] = parseObjectMatchingCsv(`${header}\n${row(7, 6)}`);

    expect(trial.id).toBe("7");
    expect(trial.candidates).toHaveLength(8);
    expect(trial.correctLabel).toBe(6);
  });

  it("uses public subset image paths from the rewritten CSV without adding the legacy prefix", () => {
    const publicRow = [
      7, "frog", "/data/rs_imagenet_100/reference/frog/7.jpg",
      ...Array.from({ length: 8 }, (_, index) => `/data/rs_imagenet_100/distractor/frog/7-${index}.jpg`),
      6,
    ].join(",");

    const [trial] = parseObjectMatchingCsv(`${header}\n${publicRow}`);

    expect(trial.referenceImage).toBe("/data/rs_imagenet_100/reference/frog/7.jpg");
    expect(trial.candidates[0]).toBe("/data/rs_imagenet_100/distractor/frog/7-0.jpg");
  });

  it("uses three training rows and limits development mode to ten testing rows", () => {
    const trials = parseObjectMatchingCsv(`${header}\n${Array.from({ length: 15 }, (_, index) => row(index)).join("\n")}`);
    const phases = splitObjectMatchingPhases(trials);

    expect(phases.training).toHaveLength(3);
    expect(phases.testing).toHaveLength(12);
    expect(selectObjectMatchingRunPhases(phases, "development").testing).toHaveLength(10);
    expect(selectObjectMatchingRunPhases(phases, "full")).toEqual(phases);
  });

  it("uses no training trials and one testing trial for local trace smoke", () => {
    const trials = parseObjectMatchingCsv(`${header}\n${Array.from({ length: 5 }, (_, index) => row(index)).join("\n")}`);

    expect(selectObjectMatchingRunPhases(splitObjectMatchingPhases(trials), "trace-smoke")).toEqual({
      training: [],
      testing: [trials[3]],
    });
  });

  it("scores the selected candidate against the private correct label", () => {
    expect(scoreObjectMatchingResponse(4, 4)).toBe(true);
    expect(scoreObjectMatchingResponse(2, 4)).toBe(false);
  });

  it("persists response records only for testing", () => {
    expect(isRecordedPhase("training")).toBe(false);
    expect(isRecordedPhase("testing")).toBe(true);
  });

  it("provides distinct large-feedback styles for correct and incorrect training", () => {
    expect(objectMatchingFeedback(true)).toEqual({ text: "Correct", className: "om-feedback-correct", durationMs: 650 });
    expect(objectMatchingFeedback(false)).toEqual({ text: "Incorrect", className: "om-feedback-incorrect", durationMs: 1000 });
  });

  it("does not expose class or correct answer in public trial data", () => {
    const [trial] = parseObjectMatchingCsv(`${header}\n${row(0)}`);
    const serialized = JSON.stringify(toPublicObjectMatchingTrial(trial));

    expect(serialized).not.toContain("className");
    expect(serialized).not.toContain("correctLabel");
  });

  it("requires the shared fixed psychophysics viewport", () => {
    expect(isObjectMatchingViewportSupported({ width: 1080, height: 675 })).toBe(true);
    expect(isObjectMatchingViewportSupported({ width: 1079, height: 675 })).toBe(false);
  });

  it("uses one shared image size and a centered grid that fits the canvas", () => {
    expect(OBJECT_IMAGE_SIZE).toBe(160);
    expect(OBJECT_STIMULUS_GRID).toEqual({ width: 720, height: 560 });
  });

  it("reveals eight labelled options only after the center cross is clicked", async () => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 1080 },
      innerHeight: { configurable: true, value: 675 },
    });
    const [trial] = parseObjectMatchingCsv(`${header}\n${row(0)}`);
    const display = document.createElement("div");
    const plugin = new ObjectMatchingPlugin({ finishTrial: () => undefined } as never);

    plugin.trial(display, {
      trial,
      phase: "testing",
      trialNumber: 1,
      totalInPhase: 1,
      prepare: () => Promise.resolve(),
      onComplete: () => undefined,
    });
    await Promise.resolve();

    expect(display.querySelectorAll(".om-candidate")).toHaveLength(0);
    display.querySelector<HTMLButtonElement>(".om-cross")?.click();
    expect(display.querySelectorAll(".om-candidate")).toHaveLength(8);
    expect(display.querySelectorAll(".om-stimulus-label")).toHaveLength(1);
    expect(display.querySelector(".om-stimulus-label")?.textContent).toBe("reference");
    expect(display.querySelectorAll(".om-reference .om-image-frame")).toHaveLength(1);
  });

  it("records each testing trajectory from the center cross through the selected option", async () => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 1080 },
      innerHeight: { configurable: true, value: 675 },
    });
    const [trial] = parseObjectMatchingCsv(`${header}\n${row(0)}`);
    const display = document.createElement("div");
    const plugin = new ObjectMatchingPlugin({ finishTrial: () => undefined } as never);
    let recorded: Array<{ trialId: string; points: Array<[number, number, number]> }> = [];

    plugin.trial(display, {
      trial,
      phase: "testing",
      trialNumber: 1,
      totalInPhase: 1,
      prepare: () => Promise.resolve(),
      onComplete: (_result, points) => { recorded = points; },
    });
    await Promise.resolve();
    display.querySelector<HTMLButtonElement>(".om-cross")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 540, clientY: 338 }),
    );
    const trialArea = display.querySelector<HTMLElement>(".vs-trial")!;
    trialArea.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 1080, height: 675,
      right: 1080, bottom: 675, x: 0, y: 0, toJSON: () => undefined,
    });
    trialArea.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 600, clientY: 338 }));
    display.querySelector<HTMLButtonElement>(".om-candidate")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 800, clientY: 338 }),
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0].trialId).toBe(trial.id);
    expect(recorded[0].points).toHaveLength(2);
    expect(recorded[0].points[0]).toEqual([0, 0, 0]);
    expect(recorded[0].points[1].slice(1)).toEqual([260, 0]);
  });
});
