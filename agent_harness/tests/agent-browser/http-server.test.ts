import { afterEach, describe, expect, it } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  startAgentBrowserHttpServer,
  type AgentBrowserHttpFactories,
} from "../../src/agent-browser/http-server";
import type { BackendEvent, BrowserHost, BrowserSession } from "../../src/browser/browser-types";
import type { RunLogEvent, RunLoggerPort } from "../../src/logging/run-logger";

const environment = {
  AGENT_BROWSER_URL: "https://example.test/tasks/visual-similarity?run=dev&participant_id=A41&model=test-model",
  AGENT_BROWSER_RUN_ID: "A41",
  AGENT_RUNS_DIR: "/tmp/visual-agent-runs",
  AGENT_BROWSER_BEARER_TOKEN: "test-bearer-token",
} satisfies NodeJS.ProcessEnv;

class FakeLogger implements RunLoggerPort {
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

class FakeSession implements BrowserSession {
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

class FakeHost implements BrowserHost {
  readonly session = new FakeSession();
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

function factoriesFor(host: FakeHost, logger: FakeLogger): AgentBrowserHttpFactories {
  return {
    createBrowserHost: () => host,
    openLogger: async () => logger,
  };
}

const handles: Array<{ close(): Promise<void>; url: string }> = [];
const clients: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (clients.length > 0) await clients.pop()!.close();
  while (handles.length > 0) await handles.pop()!.close();
});

async function connectClient(url: string, bearerToken: string): Promise<Client> {
  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: "Bearer " + bearerToken } },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

async function postJson(url: string, token?: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "fetch-client", version: "1.0.0" },
      },
    }),
  });
}

describe("startAgentBrowserHttpServer", () => {
  it("listens on loopback and rejects invalid path, token, and method", async () => {
    const host = new FakeHost();
    const logger = new FakeLogger();
    const handle = await startAgentBrowserHttpServer(environment, factoriesFor(host, logger));
    handles.push(handle);

    const endpoint = new URL(handle.url);
    expect(["127.0.0.1", "localhost"]).toContain(endpoint.hostname);

    const unauthorized = await postJson(handle.url);
    expect(unauthorized.status).toBe(401);

    const wrongToken = await postJson(handle.url, "wrong-token");
    expect(wrongToken.status).toBe(401);

    const invalidPath = await postJson(new URL("/wrong-path", endpoint).toString(), "test-bearer-token");
    expect(invalidPath.status).toBe(404);

    const invalidMethod = await fetch(handle.url, {
      method: "GET",
      headers: { Authorization: "Bearer test-bearer-token" },
    });
    expect(invalidMethod.status).toBe(405);
  });

  it("reconnects fresh MCP clients to the same toolset and browser session", async () => {
    const host = new FakeHost();
    const logger = new FakeLogger();
    const handle = await startAgentBrowserHttpServer(environment, factoriesFor(host, logger));
    handles.push(handle);

    const clientA = await connectClient(handle.url, "test-bearer-token");
    const observeA = await clientA.callTool({ name: "observe", arguments: {} });
    expect(observeA.isError).not.toBe(true);

    await clientA.close();
    clients.pop();

    const clientB = await connectClient(handle.url, "test-bearer-token");
    const observeB = await clientB.callTool({ name: "observe", arguments: {} });
    expect(observeB.isError).not.toBe(true);

    expect(host.openedUrls).toEqual([environment.AGENT_BROWSER_URL]);
    expect(host.openedViewports).toEqual([{ width: 1080, height: 675 }]);
    expect(host.session.actions).toEqual([
      ["screenshot", 90],
      ["screenshot", 90],
    ]);
    expect(logger.screenshots).toHaveLength(2);
  });

  it("closes the HTTP server and owned browser resources", async () => {
    const host = new FakeHost();
    const logger = new FakeLogger();
    const handle = await startAgentBrowserHttpServer(environment, factoriesFor(host, logger));
    handles.push(handle);

    const client = await connectClient(handle.url, "test-bearer-token");
    await client.callTool({ name: "observe", arguments: {} });

    await handle.close();

    expect(host.session.closed).toBe(true);
    expect(host.closed).toBe(true);
    expect(logger.closed).toBe(true);
    await expect(postJson(handle.url, "test-bearer-token")).rejects.toThrow();

    handles.pop();
  });
});
