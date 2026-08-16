export type ObserverType = "human" | "agent";
export type Side = "left" | "right";
export type TrialPhase = "training" | "testing";
export type SessionRunMode = "development" | "full" | "trace-smoke";

export const isRecordedPhase = (phase: TrialPhase) => phase === "testing";

export interface SessionIdentity {
  sessionId: string;
  observerType: ObserverType;
  participantId?: string;
  agentName?: string;
  agentProvider?: string;
  agentModel?: string;
  runMode?: SessionRunMode;
  startedAtUtc: string;
  randomSeed: number;
}

export interface TrialTrajectory {
  trialId: string;
  points: Array<[elapsedMs: number, xPx: number, yPx: number]>;
}

export interface VisualSimilarityTrialResult {
  task: "visual_similarity";
  trialId: string;
  phase: TrialPhase;
  csvRowIndex: number;
  sourceId: string;
  referenceImage: string;
  leftCandidate: string;
  rightCandidate: string;
  correctSide: Side;
  selectedSide: Side;
  correct: boolean;
  trialReadyAt: number;
  crossShownAt: number;
  crossClickedAt: number;
  stimulusShownAt: number;
  responseAt: number;
  reactionTimeMs: number;
  responseX: number;
  responseY: number;
  viewport: { width: number; height: number };
  prefetchStartedAt?: number;
  prefetchCompletedAt?: number;
}

export interface ObjectMatchingTrialResult {
  task: "object_matching";
  trialId: string;
  phase: TrialPhase;
  csvRowIndex: number;
  sourceId: string;
  className: string;
  referenceImage: string;
  candidates: string[];
  correctLabel: number;
  selectedLabel: number;
  correct: boolean;
  trialReadyAt: number;
  crossShownAt: number;
  crossClickedAt: number;
  stimulusShownAt: number;
  responseAt: number;
  reactionTimeMs: number;
  responseX: number;
  responseY: number;
  viewport: { width: number; height: number };
  prefetchStartedAt?: number;
  prefetchCompletedAt?: number;
}

export type TrialResult = VisualSimilarityTrialResult;
export type ExperimentTrialResult = VisualSimilarityTrialResult | ObjectMatchingTrialResult;

export interface SessionPayload {
  session: SessionIdentity;
  results: ExperimentTrialResult[];
  trajectories: TrialTrajectory[];
}
