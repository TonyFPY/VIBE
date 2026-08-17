import { describe, expect, it } from "vitest";

import { parseAgentAction } from "../../src/actions/contract";

describe("restricted agent action contract", () => {
  it("accepts exact CLICK, MOVE, and DONE actions", () => {
    expect(parseAgentAction({ type: "CLICK", x: 756, y: 386, purpose: "response" })).toEqual({
      valid: true,
      action: { type: "CLICK", x: 756, y: 386, purpose: "response" },
    });
    expect(parseAgentAction({ type: "MOVE", x: 540, y: 338 })).toEqual({
      valid: true,
      action: { type: "MOVE", x: 540, y: 338 },
    });
    expect(parseAgentAction({ type: "DONE" })).toEqual({ valid: true, action: { type: "DONE" } });
  });

  it("rejects arbitrary capabilities and silently repairable values", () => {
    expect(parseAgentAction({ type: "MOVE", x: 20, y: 30, code: "page.evaluate" }).valid).toBe(false);
    expect(parseAgentAction({ type: "CLICK", x: "20", y: 30, purpose: "response" }).valid).toBe(false);
    expect(parseAgentAction({ type: "CLICK", x: -1, y: 30, purpose: "response" }).valid).toBe(false);
    expect(parseAgentAction({ type: "CLICK", x: 20, y: 30, purpose: "solve-task" }).valid).toBe(false);
    expect(parseAgentAction({ type: "DONE", privateAnswer: "SECRET" }).valid).toBe(false);
    expect(parseAgentAction({ type: "EVALUATE", script: "document.body" }).valid).toBe(false);
  });
});
