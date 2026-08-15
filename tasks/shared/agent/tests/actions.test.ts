import { describe, expect, it } from "vitest";

import { parseAgentAction } from "../actions";

describe("external agent action boundary", () => {
  it("accepts only classified public pointer actions", () => {
    expect(parseAgentAction({ type: "CLICK", x: 756, y: 386, purpose: "fixation" })).toEqual({
      valid: true,
      action: { type: "CLICK", x: 756, y: 386, purpose: "fixation" },
    });
    expect(parseAgentAction({ type: "CLICK", x: -1, y: 386, purpose: "fixation" }).valid).toBe(false);
    expect(parseAgentAction({ type: "CLICK", x: 756, y: 386, purpose: "unknown" }).valid).toBe(false);
    expect(parseAgentAction({ type: "DONE", privateAnswer: "no" }).valid).toBe(false);
  });
});
