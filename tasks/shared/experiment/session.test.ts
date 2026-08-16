import { describe, expect, it } from "vitest";

import { createSessionIdentity } from "./session";

describe("session identity", () => {
  it("does not include browser trace policy in an agent session", () => {
    const session = createSessionIdentity(
      "?participant_id=A001&provider=openai&model=test&agent_name=codex&cursor_trace_steps=20",
    );

    expect(session).not.toHaveProperty("agentCursorTraceSteps");
  });

  it("infers human mode from an H participant id", () => {
    const session = createSessionIdentity("?observer=agent&participant_id=H001");

    expect(session).toMatchObject({
      observerType: "human",
      participantId: "H001",
    });
    expect(session.sessionId).toMatch(/^H001_local_human_/);
  });

  it("infers agent mode from an A participant id and preserves the supplied model", () => {
    const session = createSessionIdentity(
      "?observer=human&participant_id=A001&provider=openai&model=gpt-5.6-luna&agent_name=codex",
    );

    expect(session).toMatchObject({
      observerType: "agent",
      agentProvider: "openai",
      agentModel: "gpt-5.6-luna",
      agentName: "codex",
      participantId: "A001",
    });
    expect(session.sessionId).toMatch(/^A001_openai_gpt-5-6-luna_/);
  });

  it("marks development sessions in their metadata and ID", () => {
    const session = createSessionIdentity(
      "?participant_id=A001&provider=openai&model=test&agent_name=codex&run=development",
    );

    expect(session.runMode).toBe("development");
    expect(session.sessionId).toMatch(/^development_A001_openai_test_/);
  });
});
