import type { ActionResult, AgentObservation, AgentTurn } from "../actions/contract";

export interface ComputerUseAgent {
  readonly provider: string;
  readonly model: string;
  next(observation: AgentObservation, signal: AbortSignal): Promise<AgentTurn>;
  reportActionResult(
    observation: AgentObservation,
    result: ActionResult,
    signal: AbortSignal,
  ): Promise<AgentTurn>;
  close(): Promise<void>;
}
