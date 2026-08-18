export interface AgentObservation {
  screenshot: Uint8Array;
  mimeType: "image/jpeg";
  publicInstruction: string;
}

export type ComputerAction =
  | { type: "click"; x: number; y: number }
  | { type: "move"; x: number; y: number }
  | { type: "wait"; milliseconds: number };

export interface ActionResult {
  action: ComputerAction;
  status: "executed" | "rejected" | "failed";
  error?: string;
}

export type AgentActionBatchType = "navigation" | "trial";

export interface AgentTurn {
  status: "actions" | "finished" | "blocked";
  actions: readonly ComputerAction[];
  rawProviderOutput: unknown;
  actionBatchType?: AgentActionBatchType;
  providerIntent?: string;
  failureReason?: string;
}
