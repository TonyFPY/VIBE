import { afterEach, describe, expect, it } from "vitest";

import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { createVisualBrowserMcpServer, VisualBrowserToolset } from "../../src/agent-browser/mcp-server";
import type { AgentBrowserConfig } from "../../src/agent-browser/run-config";
import type { BackendEvent, BrowserHost, BrowserSession } from "../../src/browser/browser-types";
import type { RunLogEvent, RunLoggerPort } from "../../src/logging/run-logger";

const canary = "SECRET_ANSWER_CANARY";

const config: AgentBrowserConfig = {
  url: "https://example.test/tasks/object-matching?run=ops&participant_id=A46&model=test-model",
  runId: "A46",
  runsRoot: "/tmp/visual-agent-runs",
  headless: true,
  viewport: { width: 1080, height: 675 },
  screenshotQuality: 90,
  settleDelayMs: 0,
  navigationTimeoutMs: 10_000,
  mouseMoveSteps: 8,
  mouseMoveDelayMs: 0,
  repeatedSequenceLimit: 3,
};

class RecordingLogger implements RunLoggerPort {
  readonly events: RunLogEvent[] = [];
  readonly screenshots: Array<{ id: string; bytes: Uint8Array }> = [];
  closed = false;

  async log(event: RunLogEvent): Promise<void> {
    this.events.push(event);
  }

  async writeScreenshot(id: string, bytes: Uint8Array): Promise<void> {
    this.screenshots.push({ id, bytes });
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class RecordingSession implements BrowserSession {
  readonly actions: unknown[] = [];
  closed = false;

  async screenshot(quality: number): Promise<Uint8Array> {
    this.actions.push(["screenshot", quality]);
    return Uint8Array.from([0xff, 0xd8, 0xff]);
  }

  async move(x: number, y: number): Promise<void> {
    this.actions.push(["move", x, y]);
  }

  async click(x: number, y: number): Promise<void> {
    this.actions.push(["click", x, y]);
  }

  subscribeBackendEvents(_listener: (event: BackendEvent) => void): () => void {
    return () => undefined;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class RecordingHost implements BrowserHost {
  readonly session = new RecordingSession();
  openedUrls: string[] = [];
  openedViewports: Array<{ width: number; height: number }> = [];
  closed = false;

  async openSession(
    url: string,
    viewport: { width: 1080; height: 675 },
  ): Promise<BrowserSession> {
    this.openedUrls.push(url);
    this.openedViewports.push(viewport);
    return this.session;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

interface McpFixture {
  client: Client;
  server: ReturnType<typeof createVisualBrowserMcpServer>;
  toolset: VisualBrowserToolset;
  host: RecordingHost;
  logger: RecordingLogger;
}

const fixtures: McpFixture[] = [];

async function createFixture(): Promise<McpFixture> {
  const host = new RecordingHost();
  const logger = new RecordingLogger();
  const toolset = new VisualBrowserToolset({ config, browserHost: host, logger });
  const server = createVisualBrowserMcpServer(toolset);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const fixture = { client, server, toolset, host, logger };
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop()!;
    await fixture.client.close();
    await fixture.server.close();
    await fixture.toolset.close();
  }
});

function serialized(value: unknown): string {
  return JSON.stringify(value);
}

describe("VisualBrowserToolset MCP surface", () => {
  it("exposes only screenshot observation and restricted pointer/wait tools", async () => {
    const fixture = await createFixture();
    const result = await fixture.client.listTools();

    expect(result.tools.map((tool) => tool.name).sort()).toEqual(["click", "move", "observe", "wait"]);
    const moveTool = result.tools.find((tool) => tool.name === "move");
    const waitTool = result.tools.find((tool) => tool.name === "wait");
   expect(moveTool?.inputSchema).toMatchObject({ properties: { type: {}, x: {}, y: {} } });
   expect(waitTool?.inputSchema).toMatchObject({ properties: { milliseconds: {} } });
    expect(moveTool?.inputSchema).toMatchObject({ required: ["type", "x", "y"] });
    expect(waitTool?.inputSchema).toMatchObject({ required: ["milliseconds"] });
    expect(serialized(result)).not.toContain("evaluate");
    expect(serialized(result)).not.toContain("navigate");
  });

  it("returns only a JPEG image for observation and keeps browser state private", async () => {
    const fixture = await createFixture();
    const result = await fixture.client.callTool({ name: "observe", arguments: {} });

    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([
      { type: "image", data: Buffer.from([0xff, 0xd8, 0xff]).toString("base64"), mimeType: "image/jpeg" },
    ]);
    expect(fixture.host.openedUrls).toEqual([config.url]);
    expect(fixture.logger.screenshots).toHaveLength(1);
    expect(serialized(result)).not.toContain(canary);
    expect(serialized(result)).not.toContain(config.url);
    expect(serialized(result)).not.toContain("SECRET");
  });

  it("reuses one isolated browser session for all tools in a run", async () => {
    const fixture = await createFixture();

    await fixture.client.callTool({ name: "observe", arguments: {} });
    await fixture.client.callTool({ name: "move", arguments: { type: "move", x: 10, y: 20 } });
    await fixture.client.callTool({ name: "click", arguments: { type: "click", x: 30, y: 40 } });
    await fixture.client.callTool({ name: "wait", arguments: { milliseconds: 0 } });

    expect(fixture.host.openedUrls).toHaveLength(1);
    expect(fixture.host.openedViewports).toEqual([config.viewport]);
    expect(fixture.host.session.actions).toEqual([
      ["screenshot", 90],
      ["move", 10, 20],
      ["click", 30, 40],
      ["screenshot", 90],
    ]);
    expect(fixture.logger.events.map((event) => event.type)).toEqual([
      "browser-session-opened",
      "observation",
      "action-executed",
      "action-executed",
      "wait",
      "observation",
    ]);
  });

  it("requires a fresh visible observation before pointer input after a click", async () => {
    const fixture = await createFixture();

    const beforeObservation = await fixture.client.callTool({
      name: "click",
      arguments: { type: "click", x: 10, y: 20 },
    });
    expect(beforeObservation.isError).toBe(true);

    await fixture.client.callTool({ name: "observe", arguments: {} });
    const firstClick = await fixture.client.callTool({
      name: "click",
      arguments: { type: "click", x: 10, y: 20 },
    });
    expect(firstClick.isError).not.toBe(true);

    const staleMove = await fixture.client.callTool({
      name: "move",
      arguments: { type: "move", x: 30, y: 40 },
    });
    expect(staleMove.isError).toBe(true);

    await fixture.client.callTool({ name: "wait", arguments: { milliseconds: 0 } });
    const freshMove = await fixture.client.callTool({
      name: "move",
      arguments: { type: "move", x: 30, y: 40 },
    });
    const secondClick = await fixture.client.callTool({
      name: "click",
      arguments: { type: "click", x: 40, y: 50 },
    });

    expect(freshMove.isError).not.toBe(true);
    expect(secondClick.isError).not.toBe(true);
    expect(fixture.host.session.actions).toEqual([
      ["screenshot", 90],
      ["click", 10, 20],
      ["screenshot", 90],
      ["move", 30, 40],
      ["click", 40, 50],
    ]);
    expect(fixture.logger.events).toContainEqual(expect.objectContaining({
      type: "action-rejected",
      actionType: "move",
      error: "Fresh visible observation required before pointer input",
    }));
  });

  it("resets the observation gate for a fresh MCP session without reopening the browser", async () => {
    const fixture = await createFixture();

    await fixture.client.callTool({ name: "observe", arguments: {} });
    const firstMove = await fixture.client.callTool({
      name: "move",
      arguments: { type: "move", x: 10, y: 20 },
    });
    expect(firstMove.isError).not.toBe(true);

    fixture.toolset.beginMcpSession();
    const staleMove = await fixture.client.callTool({
      name: "move",
      arguments: { type: "move", x: 30, y: 40 },
    });
    expect(staleMove.isError).toBe(true);

    await fixture.client.callTool({ name: "observe", arguments: {} });
    const freshMove = await fixture.client.callTool({
      name: "move",
      arguments: { type: "move", x: 30, y: 40 },
    });
    expect(freshMove.isError).not.toBe(true);

    expect(fixture.host.openedUrls).toEqual([config.url]);
    expect(fixture.host.session.actions).toEqual([
      ["screenshot", 90],
      ["move", 10, 20],
      ["screenshot", 90],
      ["move", 30, 40],
    ]);
  });

  it("stops before recording a repeated pointer trajectory indefinitely", async () => {
    const fixture = await createFixture();
    const runSequence = async () => {
      await fixture.client.callTool({ name: "observe", arguments: {} });
      for (const [x, y] of [[100, 100], [200, 200], [300, 300]]) {
        await fixture.client.callTool({ name: "move", arguments: { type: "move", x, y } });
      }
      return fixture.client.callTool({
        name: "click",
        arguments: { type: "click", x: 400, y: 400 },
      });
    };

    expect((await runSequence()).isError).not.toBe(true);
    expect((await runSequence()).isError).not.toBe(true);
    const blocked = await runSequence();

    expect(blocked.isError).toBe(true);
    expect(fixture.host.session.actions.filter((action) => Array.isArray(action) && action[0] === "click")).toHaveLength(2);
    expect(fixture.logger.events).toContainEqual(expect.objectContaining({
      type: "abnormal-sequence-detected",
      repeatCount: 3,
    }));
    expect(fixture.logger.events).toContainEqual(expect.objectContaining({
      type: "run-aborted",
      reason: "repeated-pointer-sequence",
    }));
  });

  it("rejects and logs invalid actions without clamping or executing them", async () => {
    const fixture = await createFixture();
    const result = await fixture.client.callTool({
      name: "click",
      arguments: { type: "click", x: -1, y: 20, answer: canary },
    });

    expect(result.isError).toBe(true);
    expect(fixture.host.openedUrls).toEqual([]);
    expect(fixture.host.session.actions).toEqual([]);
    expect(fixture.logger.events).toContainEqual(expect.objectContaining({
      type: "action-rejected",
      actionType: "click",
    }));
    expect(serialized(result)).not.toContain(canary);
    expect(serialized(fixture.logger.events)).not.toContain(canary);
  });

  it("rejects a pointer action whose type does not match the MCP tool", async () => {
    const fixture = await createFixture();
    const result = await fixture.client.callTool({
      name: "move",
      arguments: { type: "click", x: 10, y: 20 },
    });

    expect(result.isError).toBe(true);
    expect(fixture.host.openedUrls).toEqual([]);
    expect(fixture.logger.events).toContainEqual(expect.objectContaining({
      type: "action-rejected",
      actionType: "move",
    }));
  });

  it("closes the browser session, host, and logger together", async () => {
   const fixture = await createFixture();
   await fixture.client.callTool({ name: "observe", arguments: {} });
   await fixture.toolset.close();

   expect(fixture.host.session.closed).toBe(true);
   expect(fixture.host.closed).toBe(true);
   expect(fixture.logger.closed).toBe(true);
 });

  it("treats an already-closed browser context as a clean shutdown", async () => {
    const fixture = await createFixture();
    await fixture.client.callTool({ name: "observe", arguments: {} });
    fixture.host.session.close = async () => { throw new Error("context already closed"); };

    await expect(fixture.toolset.close()).resolves.toBeUndefined();
    expect(fixture.host.closed).toBe(true);
    expect(fixture.logger.closed).toBe(true);
  });
});
