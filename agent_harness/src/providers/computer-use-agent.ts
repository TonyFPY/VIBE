import type { ActionResult, AgentObservation, AgentTurn } from "../actions/contract";

export interface ComputerUseAgent {
  readonly provider: string;
  readonly model: string;
  next(observation: AgentObservation, signal: AbortSignal): Promise<AgentTurn>;
  reportActionResults(
    observation: AgentObservation,
    results: readonly ActionResult[],
    signal: AbortSignal,
  ): Promise<AgentTurn>;
  close(): Promise<void>;
}
