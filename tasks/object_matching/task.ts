import { isTrialViewportSupported } from "../shared/experiment/geometry";

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

export type ObjectMatchingRunMode = "development" | "full" | "trace-smoke";
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
): ObjectMatchingTrialPhases {
  if (mode === "trace-smoke") return { training: [], testing: phases.testing.slice(0, 1) };
  return mode === "development"
    ? { training: phases.training.slice(0, 3), testing: phases.testing.slice(0, 10) }
    : phases;
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

function preloadImage(source: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => image.decode().then(resolve, reject);
    image.onerror = () => reject(new Error("Unable to load image"));
    image.src = source;
  });
}

export function preloadObjectMatchingTrial(trial: ObjectMatchingTrial): Promise<void> {
  return Promise.all([trial.referenceImage, ...trial.candidates].map(preloadImage)).then(() => undefined);
}

export class ObjectMatchingPreloadBuffer {
  private readonly jobs = new Map<number, Promise<void>>();

  constructor(private readonly trials: ObjectMatchingTrial[], private readonly size = 3) {}

  prepare(index: number): Promise<void> {
    for (let next = index; next <= index + this.size && next < this.trials.length; next += 1) {
      if (!this.jobs.has(next)) this.jobs.set(next, preloadObjectMatchingTrial(this.trials[next]));
    }
    return this.jobs.get(index) ?? Promise.resolve();
  }
}
