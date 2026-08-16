import { describe, expect, it } from "vitest";

import { createSessionIdentity } from "./session";

describe("session identity", () => {
  it("does not include browser trace policy in an agent session", () => {
    const session = createSessionIdentity(
      "?observer=agent&provider=openai&model=test&agent_name=codex&cursor_trace_steps=20",
    );

    expect(session).not.toHaveProperty("agentCursorTraceSteps");
  });

  it("uses supplied agent identity fields", () => {
    const session = createSessionIdentity("?observer=agent&provider=openai&model=test&agent_name=codex");

    expect(session).toMatchObject({
      observerType: "agent",
      agentProvider: "openai",
      agentModel: "test",
      agentName: "codex",
    });
  });

  it("marks development sessions in their metadata and ID", () => {
    const session = createSessionIdentity("?observer=agent&provider=openai&model=test&agent_name=codex&run=development");

    expect(session.runMode).toBe("development");
    expect(session.sessionId).toMatch(/^development_codex_openai_test_/);
  });
});
