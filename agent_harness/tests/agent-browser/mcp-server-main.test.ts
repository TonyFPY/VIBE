import { afterEach, describe, expect, it } from "vitest";

import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  startAgentBrowserMcp,
  type AgentBrowserMcpFactories,
} from "../../src/agent-browser/mcp-server-main";
import type { BackendEvent, BrowserHost, BrowserSession } from "../../src/browser/browser-types";
import type { RunLogEvent, RunLoggerPort } from "../../src/logging/run-logger";

const environment = {
  AGENT_BROWSER_URL: "https://example.test/tasks/visual-similarity?run=dev&participant_id=A41&model=test-model",
  AGENT_BROWSER_RUN_ID: "A41",
  AGENT_RUNS_DIR: "/tmp/visual-agent-runs",
} satisfies NodeJS.ProcessEnv;

class FakeLogger implements RunLoggerPort {
  readonly events: RunLogEvent[] = [];
  closed = false;

  async log(event: RunLogEvent): Promise<void> {
    this.events.push(event);
  }

  async writeScreenshot(): Promise<void> {}

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeHost implements BrowserHost {
  readonly session: BrowserSession = {
    screenshot: async () => Uint8Array.from([0xff, 0xd8, 0xff]),
    move: async () => undefined,
    click: async () => undefined,
    subscribeBackendEvents: (_listener: (event: BackendEvent) => void) => () => undefined,
    close: async () => undefined,
  };
  readonly options: Array<{ headless: boolean }> = [];
  closed = false;

  constructor(headless: boolean) {
    this.options.push({ headless });
  }

  async openSession(): Promise<BrowserSession> {
    return this.session;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function factoriesFor(
  host: FakeHost,
  logger: FakeLogger,
  transport: AgentBrowserMcpFactories["createTransport"] extends () => infer T ? T : never,
): AgentBrowserMcpFactories {
  return {
    createBrowserHost: ({ headless }) => {
      expect(headless).toBe(host.options[0]?.headless);
      return host;
    },
    openLogger: async () => logger,
    createTransport: () => transport,
  };
}

const handles: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
});

describe("startAgentBrowserMcp", () => {
  it("constructs a configured server and closes all owned resources", async () => {
    const host = new FakeHost(true);
    const logger = new FakeLogger();
    const [, serverTransport] = InMemoryTransport.createLinkedPair();
    const handle = await startAgentBrowserMcp(
      environment,
      factoriesFor(host, logger, serverTransport),
    );
    handles.push(handle);

    expect(handle.config.headless).toBe(true);
    expect(handle.server.isConnected()).toBe(true);

    await handle.close();
    expect(host.closed).toBe(true);
    expect(logger.closed).toBe(true);
  });

  it("passes an explicit headed configuration to the browser factory", async () => {
    const host = new FakeHost(false);
    const logger = new FakeLogger();
    const [, serverTransport] = InMemoryTransport.createLinkedPair();
    const handle = await startAgentBrowserMcp(
      { ...environment, AGENT_BROWSER_HEADLESS: "false" },
      factoriesFor(host, logger, serverTransport),
    );
    handles.push(handle);

    expect(handle.config.headless).toBe(false);
    expect(host.options).toEqual([{ headless: false }]);
  });
});
