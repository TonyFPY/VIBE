// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  pointerTupleAtCross,
  shouldSamplePointer,
  parseDreamSimCsv,
  TripletPreloadBuffer,
  scoreResponse,
  selectRunPhases,
  splitExperimentPhases,
  toPublicTrial,
  isTrialViewportSupported,
  type RunMode,
  type TrialPhases,
} from "../task";
import { InstructionPlugin, TestReadyPlugin, VisualSimilarityPlugin } from "../renderer";
import { trainingAlignmentFeedback } from "../task";
import { calculateReactionTimeMs } from "../../shared/experiment/geometry";

describe("visual similarity task", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prioritizes the current trial before prefetching exactly three future trials", async () => {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decode = () => Promise.resolve();
      src = "";

      finishLoad(): void {
        this.onload?.();
      }
    }
    const images: FakeImage[] = [];
    const ImageConstructor = class extends FakeImage {
      constructor() {
        super();
        images.push(this);
      }
    };
    vi.stubGlobal("Image", ImageConstructor);
    const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    const trials = parseDreamSimCsv(
      "id,left_vote,right_vote,ref_path,left_path,right_path\n" +
        Array.from({ length: 6 }, (_, index) => `${index + 1},1,0,ref/${index}.png,left/${index}.png,right/${index}.png`).join("\n"),
    );
    const buffer = new TripletPreloadBuffer(trials);

    const current = buffer.prepare(0);

    expect(images).toHaveLength(3);
    images.forEach((image) => image.finishLoad());
    await current;
    await flush();

    expect(images).toHaveLength(6);
    images.slice(3, 6).forEach((image) => image.finishLoad());
    await flush();
    expect(images).toHaveLength(9);
    images.slice(6, 9).forEach((image) => image.finishLoad());
    await flush();
    expect(images).toHaveLength(12);
  });

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

  it("shuffles only the testing phase when a session seed is supplied", () => {
    const rows = parseDreamSimCsv(
      "id,left_vote,right_vote,ref_path,left_path,right_path\n" +
        Array.from({ length: 15 }, (_, index) => `${index + 1},1,0,ref/${index}.png,left/${index}.png,right/${index}.png`).join("\n"),
    );
    const phases = splitExperimentPhases(rows);
    const selectWithSeed = selectRunPhases as unknown as (
      phases: TrialPhases,
      mode: RunMode,
      seed: string,
    ) => TrialPhases;

    const shuffled = selectWithSeed(phases, "full", "session-001");

    expect(shuffled.training).toEqual(phases.training);
    expect(shuffled.testing).toHaveLength(12);
    expect(shuffled.testing.map((trial) => trial.id)).not.toEqual(phases.testing.map((trial) => trial.id));
    expect(shuffled.testing.map((trial) => trial.id)).toEqual(
      selectWithSeed(phases, "full", "session-001").testing.map((trial) => trial.id),
    );
  });

  it("shuffles the selected development testing rows without adding later rows", () => {
    const rows = parseDreamSimCsv(
      "id,left_vote,right_vote,ref_path,left_path,right_path\n" +
        Array.from({ length: 15 }, (_, index) => `${index + 1},1,0,ref/${index}.png,left/${index}.png,right/${index}.png`).join("\n"),
    );
    const phases = splitExperimentPhases(rows);
    const selectWithSeed = selectRunPhases as unknown as (
      phases: TrialPhases,
      mode: RunMode,
      seed: string,
    ) => TrialPhases;

    const selected = selectWithSeed(phases, "development", "session-001");

    expect(selected.training).toEqual(phases.training);
    expect(selected.testing).toHaveLength(10);
    expect(new Set(selected.testing.map((trial) => trial.id))).toEqual(
      new Set(phases.testing.slice(0, 10).map((trial) => trial.id)),
    );
  });

  it("scores a selected candidate against the private target side", () => {
    expect(scoreResponse("left", "left")).toBe(true);
    expect(scoreResponse("right", "left")).toBe(false);
  });

  it("encodes a pointer sample as a rounded cross-centered pixel tuple", () => {
    expect(pointerTupleAtCross({ x: 600.4, y: 300.4 }, { x: 540, y: 338 }, 16.8)).toEqual([17, 60, -38]);
  });

  it("keeps intermediate samples only after enough time and movement", () => {
    expect(shouldSamplePointer([0, 0, 0], [16, 1, 1])).toBe(false);
    expect(shouldSamplePointer([0, 0, 0], [16, 2, 0])).toBe(true);
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

  it("records each testing trajectory from the center cross through the selected candidate", async () => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 1080 },
      innerHeight: { configurable: true, value: 675 },
    });
    const plugin = new VisualSimilarityPlugin({ finishTrial: () => undefined } as never);
    const [trial] = parseDreamSimCsv("id,left_vote,right_vote,ref_path,left_path,right_path\n1,1,0,ref/a.png,left/a.png,right/a.png");
    const display = document.createElement("div");
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
    display.querySelector<HTMLButtonElement>(".vs-cross")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 540, clientY: 338 }),
    );
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

    expect(recorded).toHaveLength(1);
    expect(recorded[0].trialId).toBe(trial.id);
    expect(recorded[0].points).toHaveLength(2);
    expect(recorded[0].points[0]).toEqual([0, 0, 0]);
    expect(recorded[0].points[1].slice(1)).toEqual([260, 0]);
  });

  it("uses human-readable alignment feedback during training", () => {
    expect(trainingAlignmentFeedback(true)).toBe("Aligned with most human responses");
    expect(trainingAlignmentFeedback(false)).toBe("Not aligned with most human responses");
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
