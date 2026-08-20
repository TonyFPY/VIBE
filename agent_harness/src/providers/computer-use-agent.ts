import type { ActionResult, AgentObservation, AgentTurn } from "../actions/contract";

export interface ComputerUseAgent {
  readonly provider: string;
  readonly model: string;
  /**
   * @deprecated Fixation is provider-mediated. Retained for compatibility with
   * older adapters; the run loop no longer uses this capability.
   */
  readonly automaticCenterFixation?: boolean;
  next(observation: AgentObservation, signal: AbortSignal): Promise<AgentTurn>;
  reportActionResults(
    observation: AgentObservation,
    results: readonly ActionResult[],
    signal: AbortSignal,
  ): Promise<AgentTurn>;
  resetContext?(): Promise<void>;
  close(): Promise<void>;
}
