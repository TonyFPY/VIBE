import { isTrialViewportSupported } from "../shared/experiment/geometry";
import { preloadImage } from "../shared/experiment/image-preload";
import { shuffleTestingPhase } from "../shared/experiment/randomization";

export interface ObjectMatchingTrial {
  id: string;
  csvRowIndex: number;
  className: string;
  referenceImage: string;
  candidates: string[];
  correctLabel: number;
}

export interface ObjectMatchingTrialPhases {
  training: ObjectMatchingTrial[];
  testing: ObjectMatchingTrial[];
}

export type ObjectMatchingRunMode = "development" | "full";
export const OBJECT_IMAGE_SIZE = 160;
export const OBJECT_STIMULUS_GRID = { width: 720, height: 560 } as const;

export interface PublicObjectMatchingTrial {
  referenceImage: string;
  candidates: string[];
}

function toAssetPath(path: string): string {
  return path.startsWith("/") ? path : `/data/rs_imagenet/${path}`;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  cells.push(value);
  return cells;
}

export function parseObjectMatchingCsv(csv: string): ObjectMatchingTrial[] {
  const lines = csv.trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift() ?? "");
  const indexOf = (field: string) => {
    const index = headers.indexOf(field);
    if (index < 0) throw new Error(`CSV is missing ${field}`);
    return index;
  };
  const trialId = indexOf("trial_id");
  const className = indexOf("class_name");
  const reference = indexOf("reference");
  const correctLabel = indexOf("correct_label");
  const candidateIndexes = Array.from({ length: 8 }, (_, index) => indexOf(`candidate_${index}`));

  return lines.filter(Boolean).map((line, csvRowIndex) => {
    const row = parseCsvLine(line);
    const label = Number(row[correctLabel]);
    if (!Number.isInteger(label) || label < 0 || label > 7) {
      throw new Error(`Trial ${row[trialId]} has an invalid correct_label`);
    }
    return {
      id: row[trialId] || String(csvRowIndex),
      csvRowIndex,
      className: row[className],
      referenceImage: toAssetPath(row[reference]),
      candidates: candidateIndexes.map((index) => toAssetPath(row[index])),
      correctLabel: label,
    };
  });
}

export const splitObjectMatchingPhases = (trials: ObjectMatchingTrial[]): ObjectMatchingTrialPhases => ({
  training: trials.slice(0, 3),
  testing: trials.slice(3),
});

export function selectObjectMatchingRunPhases(
  phases: ObjectMatchingTrialPhases,
  mode: ObjectMatchingRunMode,
  shuffleSeed?: string,
): ObjectMatchingTrialPhases {
  const selected = mode === "development"
    ? { training: phases.training.slice(0, 3), testing: phases.testing.slice(0, 10) }
    : phases;
  return shuffleSeed ? shuffleTestingPhase(selected, shuffleSeed) : selected;
}

export const scoreObjectMatchingResponse = (selectedLabel: number, correctLabel: number) => selectedLabel === correctLabel;
export const objectMatchingFeedback = (correct: boolean) => correct
  ? { text: "Correct", className: "om-feedback-correct", durationMs: 750 }
  : { text: "Incorrect", className: "om-feedback-incorrect", durationMs: 1000 };
export const isObjectMatchingViewportSupported = isTrialViewportSupported;

export const toPublicObjectMatchingTrial = (trial: ObjectMatchingTrial): PublicObjectMatchingTrial => ({
  referenceImage: trial.referenceImage,
  candidates: trial.candidates,
});

export function preloadObjectMatchingTrial(trial: ObjectMatchingTrial): Promise<void> {
  return Promise.all([trial.referenceImage, ...trial.candidates].map(preloadImage)).then(() => undefined);
}

export class ObjectMatchingPreloadBuffer {
  private readonly jobs = new Map<number, Promise<void>>();
  private prefetchChain = Promise.resolve();

  constructor(private readonly trials: ObjectMatchingTrial[], private readonly size = 3) {}

  private ensure(index: number): Promise<void> {
    if (!this.jobs.has(index)) this.jobs.set(index, preloadObjectMatchingTrial(this.trials[index]));
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
