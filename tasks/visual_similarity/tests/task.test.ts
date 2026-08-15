// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  normalizePointer,
  parseDreamSimCsv,
  scoreResponse,
  selectRunPhases,
  splitExperimentPhases,
  toPublicTrial,
  isTrialViewportSupported,
} from "../task";
import { InstructionPlugin, TestReadyPlugin, VisualSimilarityPlugin } from "../renderer";
import { trainingAlignmentFeedback, trainingAlignmentFeedbackDuration } from "../task";
import { calculateReactionTimeMs } from "../../shared/experiment/geometry";

describe("visual similarity task", () => {
  it("uses the first three rows as training and the rest as testing", () => {
    const rows = parseDreamSimCsv(
      "id,left_vote,right_vote,ref_path,left_path,right_path\n" +
        "1,1,0,ref/a.png,left/a.png,right/a.png\n" +
        "2,0,1,ref/b.png,left/b.png,right/b.png\n" +
        "3,1,0,ref/c.png,left/c.png,right/c.png\n" +
        "4,0,1,ref/d.png,left/d.png,right/d.png",
    );

    const phases = splitExperimentPhases(rows);
    expect(phases.training).toHaveLength(3);
    expect(phases.testing).toHaveLength(1);
    expect(phases.testing[0].id).toBe("4");
  });

  it("limits development mode to three training and ten testing trials", () => {
    const rows = parseDreamSimCsv(
      "id,left_vote,right_vote,ref_path,left_path,right_path\n" +
        Array.from({ length: 15 }, (_, index) => `${index + 1},1,0,ref/${index}.png,left/${index}.png,right/${index}.png`).join("\n"),
    );
    const phases = splitExperimentPhases(rows);

    expect(selectRunPhases(phases, "development")).toEqual({
      training: phases.training.slice(0, 3),
      testing: phases.testing.slice(0, 10),
    });
    expect(selectRunPhases(phases, "full")).toEqual(phases);
  });

  it("uses no training trials and one testing trial for local trace smoke", () => {
    const rows = parseDreamSimCsv(
      "id,left_vote,right_vote,ref_path,left_path,right_path\n" +
        Array.from({ length: 5 }, (_, index) => `${index + 1},1,0,ref/${index}.png,left/${index}.png,right/${index}.png`).join("\n"),
    );

    expect(selectRunPhases(splitExperimentPhases(rows), "trace-smoke")).toEqual({
      training: [],
      testing: [rows[3]],
    });
  });

  it("scores a selected candidate against the private target side", () => {
    expect(scoreResponse("left", "left")).toBe(true);
    expect(scoreResponse("right", "left")).toBe(false);
  });

  it("normalizes a pointer sample against the trial area and center", () => {
    expect(normalizePointer({ x: 600, y: 300 }, { left: 100, top: 100, width: 1000, height: 500 })).toEqual({
      xRaw: 600,
      yRaw: 300,
      xNorm: 0.5,
      yNorm: 0.4,
      xCentered: 0,
      yCentered: -0.1,
    });
  });

  it("calculates reaction time from center-cross click to response", () => {
    expect(calculateReactionTimeMs(150.4, 812.9)).toBeCloseTo(662.5);
  });

  it("never exposes the private correct side in public renderer data", () => {
    const [trial] = parseDreamSimCsv("id,left_vote,right_vote,ref_path,left_path,right_path\n1,1,0,ref/a.png,left/a.png,right/a.png");
    expect(JSON.stringify(toPublicTrial(trial))).not.toContain("correctSide");
    expect(JSON.stringify(toPublicTrial(trial))).not.toContain("left_vote");
  });

  it("uses public DreamSim subset paths from the converted CSV without adding the legacy prefix", () => {
    const [trial] = parseDreamSimCsv(
      "id,left_vote,right_vote,ref_path,left_path,right_path\n" +
        "1,1,0,/data/dreamsim_100/ref/a.jpg,/data/dreamsim_100/left/a.jpg,/data/dreamsim_100/right/a.jpg",
    );

    expect(toPublicTrial(trial)).toEqual({
      referenceImage: "/data/dreamsim_100/ref/a.jpg",
      leftCandidate: "/data/dreamsim_100/left/a.jpg",
      rightCandidate: "/data/dreamsim_100/right/a.jpg",
    });
  });

  it("keeps the jsPsych trial pending while images preload", () => {
    const plugin = new VisualSimilarityPlugin({ finishTrial: () => undefined } as never);
    const pending = new Promise<void>(() => undefined);
    const [trial] = parseDreamSimCsv("id,left_vote,right_vote,ref_path,left_path,right_path\n1,1,0,ref/a.png,left/a.png,right/a.png");

    const returned = plugin.trial(document.createElement("div"), {
      trial,
      phase: "training",
      trialNumber: 1,
      totalInPhase: 3,
      prepare: () => pending,
      onComplete: () => undefined,
    });

    expect(returned).toBeUndefined();
  });

  it("aligns the center cross with three equal stimulus frames", async () => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 1080 },
      innerHeight: { configurable: true, value: 675 },
    });
    const plugin = new VisualSimilarityPlugin({ finishTrial: () => undefined } as never);
    const [trial] = parseDreamSimCsv("id,left_vote,right_vote,ref_path,left_path,right_path\n1,1,0,ref/a.png,left/a.png,right/a.png");
    const display = document.createElement("div");

    plugin.trial(display, {
      trial,
      phase: "testing",
      trialNumber: 1,
      totalInPhase: 1,
      prepare: () => Promise.resolve(),
      onComplete: () => undefined,
    });
    await Promise.resolve();

    expect(display.querySelector(".vs-cross-slot")).not.toBeNull();
    expect(display.querySelectorAll(".vs-image-slot")).toHaveLength(0);
    display.querySelector<HTMLButtonElement>(".vs-cross")?.click();
    const frames = display.querySelectorAll(".vs-image-frame");
    expect(frames).toHaveLength(3);
    expect(Array.from(frames, (frame) => frame.querySelector("img")?.alt)).toEqual([
      "Left candidate",
      "Reference image",
      "Right candidate",
    ]);
    expect(Array.from(display.querySelectorAll(".vs-stimulus-label"), (label) => label.textContent)).toEqual([
      "reference",
    ]);
  });

  it("records post-fixation pointer moves in the existing trajectory callback", async () => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 1080 },
      innerHeight: { configurable: true, value: 675 },
    });
    const plugin = new VisualSimilarityPlugin({ finishTrial: () => undefined } as never);
    const [trial] = parseDreamSimCsv("id,left_vote,right_vote,ref_path,left_path,right_path\n1,1,0,ref/a.png,left/a.png,right/a.png");
    const display = document.createElement("div");
    let recorded: Array<{ xRaw: number; yRaw: number }> = [];

    plugin.trial(display, {
      trial,
      phase: "testing",
      trialNumber: 1,
      totalInPhase: 1,
      prepare: () => Promise.resolve(),
      onComplete: (_result, points) => { recorded = points; },
    });
    await Promise.resolve();
    display.querySelector<HTMLButtonElement>(".vs-cross")?.click();
    const trialArea = display.querySelector<HTMLElement>(".vs-trial")!;
    trialArea.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 1080, height: 675,
      right: 1080, bottom: 675, x: 0, y: 0, toJSON: () => undefined,
    });
    trialArea.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 600, clientY: 338 }));
    trialArea.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 800, clientY: 338 }));
    display.querySelector<HTMLButtonElement>(".vs-candidate")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 800, clientY: 338 }),
    );

    expect(recorded.map(({ xRaw, yRaw }) => ({ xRaw, yRaw }))).toEqual([
      { xRaw: 600, yRaw: 338 },
      { xRaw: 800, yRaw: 338 },
    ]);
  });

  it("uses human-readable alignment feedback during training", () => {
    expect(trainingAlignmentFeedback(true)).toBe("Aligned with most human responses");
    expect(trainingAlignmentFeedback(false)).toBe("Not aligned with most human responses");
    expect(trainingAlignmentFeedbackDuration(true)).toBe(650);
    expect(trainingAlignmentFeedbackDuration(false)).toBe(1000);
  });

  it("requires a viewport large enough for the fixed trial canvas", () => {
    expect(isTrialViewportSupported({ width: 1080, height: 675 })).toBe(true);
    expect(isTrialViewportSupported({ width: 1079, height: 675 })).toBe(false);
    expect(isTrialViewportSupported({ width: 1080, height: 674 })).toBe(false);
  });

  it("requires an explicit confirmation before testing begins", () => {
    let finishes = 0;
    const display = document.createElement("div");
    const plugin = new TestReadyPlugin({ finishTrial: () => { finishes += 1; } } as never);

    plugin.trial(display);

    expect(display.textContent).toContain("Are you ready for the real test?");
    expect(finishes).toBe(0);
    display.querySelector<HTMLButtonElement>("button")?.click();
    expect(finishes).toBe(1);
  });
});
