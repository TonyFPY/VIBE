import type { Side } from "../shared/experiment/types";
import { preloadImage } from "../shared/experiment/image-preload";
import {
  isTrialViewportSupported,
  pointerTupleAtCross,
  shouldSamplePointer,
  TRIAL_CANVAS,
} from "../shared/experiment/geometry";
import { shuffleTestingPhase } from "../shared/experiment/randomization";

export { isTrialViewportSupported, pointerTupleAtCross, shouldSamplePointer, TRIAL_CANVAS } from "../shared/experiment/geometry";

export interface DreamSimTrial {
  id: string;
  csvRowIndex: number;
  referenceImage: string;
  leftCandidate: string;
  rightCandidate: string;
  correctSide: Side;
}

export interface TrialPhases { training: DreamSimTrial[]; testing: DreamSimTrial[]; }
export type RunMode = "development" | "full";
export interface PublicTrial { referenceImage: string; leftCandidate: string; rightCandidate: string; }

function toAssetPath(path: string): string {
  return path.startsWith("/") ? path : `/data/dreamsim/${path}`;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted;
    } else if (character === "," && !quoted) { cells.push(value); value = ""; } else value += character;
  }
  cells.push(value);
  return cells;
}

export function parseDreamSimCsv(csv: string): DreamSimTrial[] {
  const lines = csv.trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift() ?? "");
  const indexOf = (field: string) => {
    const index = headers.indexOf(field);
    if (index < 0) throw new Error(`CSV is missing ${field}`);
    return index;
  };
  const [id, leftVote, rightVote, refPath, leftPath, rightPath] = ["id", "left_vote", "right_vote", "ref_path", "left_path", "right_path"].map(indexOf);
  return lines.filter(Boolean).map((line, csvRowIndex) => {
    const row = parseCsvLine(line);
    const left = Number(row[leftVote]);
    const right = Number(row[rightVote]);
    if (left === right) throw new Error(`Trial ${row[id]} has no unique correct side`);
    return {
      id: row[id], csvRowIndex,
      referenceImage: toAssetPath(row[refPath]),
      leftCandidate: toAssetPath(row[leftPath]),
      rightCandidate: toAssetPath(row[rightPath]),
      correctSide: left > right ? "left" : "right",
    };
  });
}

export const splitExperimentPhases = (trials: DreamSimTrial[]): TrialPhases => ({ training: trials.slice(0, 3), testing: trials.slice(3) });
export function selectRunPhases(phases: TrialPhases, mode: RunMode, shuffleSeed?: string): TrialPhases {
  const selected = mode === "development"
    ? { training: phases.training.slice(0, 3), testing: phases.testing.slice(0, 10) }
    : phases;
  return shuffleSeed ? shuffleTestingPhase(selected, shuffleSeed) : selected;
}
export const scoreResponse = (selectedSide: Side, correctSide: Side) => selectedSide === correctSide;
export const trainingAlignmentFeedback = (correct: boolean) => (
  correct ? "Aligned with most human responses" : "Not aligned with most human responses"
);
export const trainingAlignmentFeedbackDuration = (correct: boolean) => correct ? 1000 : 1200;
export const toPublicTrial = (trial: DreamSimTrial): PublicTrial => ({
  referenceImage: trial.referenceImage,
  leftCandidate: trial.leftCandidate,
  rightCandidate: trial.rightCandidate,
});

export async function preloadTriplet(trial: DreamSimTrial): Promise<void> {
  await Promise.all([trial.referenceImage, trial.leftCandidate, trial.rightCandidate].map(preloadImage));
}

export class TripletPreloadBuffer {
  private readonly jobs = new Map<number, Promise<void>>();
  private prefetchChain = Promise.resolve();
  constructor(private readonly trials: DreamSimTrial[], private readonly size = 3) {}

  private ensure(index: number): Promise<void> {
    if (!this.jobs.has(index)) this.jobs.set(index, preloadTriplet(this.trials[index]));
    return this.jobs.get(index)!;
  }

  prepare(index: number): Promise<void> {
    const current = this.ensure(index);
    void current.then(() => {
      this.prefetchChain = this.prefetchChain.then(async () => {
        for (let next = index + 1; next <= index + this.size && next < this.trials.length; next += 1) {
          try {
            await this.ensure(next);
          } catch {
            // A failed lookahead is retried if that trial becomes current.
          }
        }
      });
    }, () => undefined);
    return current;
  }
}
