import { describe, expect, it } from "vitest";

import { parseAgentBrowserConfig } from "../../src/agent-browser/run-config";

const validEnvironment = {
  AGENT_BROWSER_URL: "https://vibe-9d6e5.web.app/tasks/object-matching?run=ops&participant_id=A46&model=gpt-5.6-luna-medium",
  AGENT_BROWSER_RUN_ID: "A46",
  AGENT_RUNS_DIR: "/tmp/visual-agent-runs",
} satisfies NodeJS.ProcessEnv;

describe("parseAgentBrowserConfig", () => {
  it("defaults to an actual headless browser with the shared viewport", () => {
    const config = parseAgentBrowserConfig(validEnvironment);

    expect(config).toMatchObject({
      url: validEnvironment.AGENT_BROWSER_URL,
      runId: "A46",
      runsRoot: "/tmp/visual-agent-runs",
      headless: true,
      viewport: { width: 1080, height: 675 },
      repeatedSequenceLimit: 5,
    });
  });

  it("accepts an explicit headed override without changing the URL", () => {
    const config = parseAgentBrowserConfig({ ...validEnvironment, AGENT_BROWSER_HEADLESS: "false" });

    expect(config.headless).toBe(false);
    expect(config.url).toBe(validEnvironment.AGENT_BROWSER_URL);
  });

  it("allows the repeated-sequence guard to be tuned explicitly", () => {
    expect(parseAgentBrowserConfig({
      ...validEnvironment,
      AGENT_BROWSER_REPEATED_SEQUENCE_LIMIT: "8",
    }).repeatedSequenceLimit).toBe(8);
  });

  it.each([
    ["AGENT_BROWSER_URL", { AGENT_BROWSER_URL: "https://example.test/not-a-task" }],
    ["AGENT_BROWSER_RUN_ID", { AGENT_BROWSER_RUN_ID: "../escape" }],
    ["AGENT_BROWSER_HEADLESS", { AGENT_BROWSER_HEADLESS: "sometimes" }],
    ["AGENT_BROWSER_REPEATED_SEQUENCE_LIMIT", { AGENT_BROWSER_REPEATED_SEQUENCE_LIMIT: "1" }],
  ])("rejects invalid %s", (_label, overrides) => {
    expect(() => parseAgentBrowserConfig({ ...validEnvironment, ...overrides })).toThrow();
  });

  it("rejects an experiment URL without the required public session parameters", () => {
    expect(() => parseAgentBrowserConfig({
      ...validEnvironment,
      AGENT_BROWSER_URL: "https://example.test/tasks/object-matching",
    })).toThrow(/participant_id|model|run/i);
  });
});
