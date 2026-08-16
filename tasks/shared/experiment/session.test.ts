import { describe, expect, it } from "vitest";

import { createSessionIdentity } from "./session";

describe("session identity", () => {
  it("normalizes a human development session to the compact saved schema", () => {
    const session = createSessionIdentity("?participant_id=H001&run=dev&provider=ignored&agent_name=ignored");

    expect(session).toMatchObject({
      participantId: "001",
      participantType: "human",
      model: "None",
      runMode: "dev",
    });
    expect(session).toEqual(expect.objectContaining({
      sessionId: expect.stringMatching(/^dev_human_001_/),
    }));
    expect(Object.keys(session).sort()).toEqual(["model", "participantId", "participantType", "runMode", "sessionId"]);
  });

  it("normalizes an agent operation session and keeps only the model metadata", () => {
    const session = createSessionIdentity("?participant_id=A001&model=gpt-5.6-luna&run=ops&provider=openai&agent_name=codex");

    expect(session).toMatchObject({
      participantId: "001",
      participantType: "agent",
      model: "gpt-5.6-luna",
      runMode: "ops",
    });
    expect(session.sessionId).toMatch(/^ops_agent_001_/);
  });

  it("maps the legacy development value to dev", () => {
    const session = createSessionIdentity("?participant_id=H002&run=development");

    expect(session).toMatchObject({
      participantId: "002",
      participantType: "human",
      model: "None",
      runMode: "dev",
    });
    expect(session.sessionId).toMatch(/^dev_human_002_/);
  });

  it("defaults unknown and missing run selectors to dev", () => {
    expect(createSessionIdentity("?participant_id=H001&run=preview").runMode).toBe("dev");
    expect(createSessionIdentity("?participant_id=H001").runMode).toBe("dev");
  });
});
