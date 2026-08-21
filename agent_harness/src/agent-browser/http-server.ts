import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { createVisualBrowserMcpServer } from "./mcp-server";
import {
  createAgentBrowserToolset,
  type AgentBrowserToolsetFactories,
} from "./mcp-server-main";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PATH = "/mcp";

export interface AgentBrowserHttpFactories extends AgentBrowserToolsetFactories {}

export interface AgentBrowserHttpHandle {
  readonly url: string;
  close(): Promise<void>;
}

interface SessionHandle {
  readonly transport: StreamableHTTPServerTransport;
  readonly server: ReturnType<typeof createVisualBrowserMcpServer>;
  closed: boolean;
  close(): Promise<void>;
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]?.trim();
  if (!value) throw new Error(key + " is required");
  return value;
}

function parseLoopbackHost(environment: NodeJS.ProcessEnv): string {
  const host = environment.AGENT_BROWSER_MCP_HOST?.trim() || DEFAULT_HOST;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("AGENT_BROWSER_MCP_HOST must be a loopback host");
  }
  return host;
}

function parsePort(environment: NodeJS.ProcessEnv): number {
  const raw = environment.AGENT_BROWSER_MCP_PORT?.trim();
  if (!raw) return 0;
  if (!/^\d+$/.test(raw)) throw new Error("AGENT_BROWSER_MCP_PORT must be an integer from 0 through 65535");
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error("AGENT_BROWSER_MCP_PORT must be an integer from 0 through 65535");
  }
  return port;
}

function parsePath(environment: NodeJS.ProcessEnv): string {
  const path = environment.AGENT_BROWSER_MCP_PATH?.trim() || DEFAULT_PATH;
  if (!path.startsWith("/")) throw new Error("AGENT_BROWSER_MCP_PATH must start with /");
  return path;
}

function unauthorized(response: ServerResponse): void {
  response.writeHead(401).end();
}

function notFound(response: ServerResponse): void {
  response.writeHead(404).end();
}

function methodNotAllowed(response: ServerResponse): void {
  response.writeHead(405).end();
}

function badRequest(response: ServerResponse): void {
  response.writeHead(400).end();
}

function internalServerError(response: ServerResponse): void {
  response.writeHead(500).end();
}

function matchesBearerToken(request: IncomingMessage, expectedToken: string): boolean {
  const authorization = request.headers.authorization;
  return authorization === "Bearer " + expectedToken;
}

function normalizeSessionId(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) return header[0];
  return header?.trim() || undefined;
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    request.once("error", reject);
    request.once("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
  });
}

function closeServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function listen(server: HttpServer, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

export async function startAgentBrowserHttpServer(
  environment: NodeJS.ProcessEnv = process.env,
  factories: AgentBrowserHttpFactories,
): Promise<AgentBrowserHttpHandle> {
  const host = parseLoopbackHost(environment);
  const port = parsePort(environment);
  const path = parsePath(environment);
  const bearerToken = requiredEnvironment(environment, "AGENT_BROWSER_BEARER_TOKEN");
  const { toolset } = await createAgentBrowserToolset(environment, factories);

  const sessions = new Map<string, SessionHandle>();
  const allSessions = new Set<SessionHandle>();
  let closed = false;

  async function createSession(): Promise<SessionHandle> {
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: () => randomUUID(),
    });
    const server = createVisualBrowserMcpServer(toolset);
    const session: SessionHandle = {
      transport,
      server,
      closed: false,
      close: async () => {
        if (session.closed) return;
        session.closed = true;
        try {
          await server.close();
        } finally {
          const sessionId = transport.sessionId;
          if (sessionId) sessions.delete(sessionId);
          allSessions.delete(session);
        }
      },
    };
    transport.onclose = () => {
      void session.close();
    };
    await server.connect(transport);
    allSessions.add(session);
    return session;
  }

  const httpServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://" + (request.headers.host || host));
      if (url.pathname !== path) {
        notFound(response);
        return;
      }
      if (!matchesBearerToken(request, bearerToken)) {
        unauthorized(response);
        return;
      }
      if (request.method !== "GET" && request.method !== "POST" && request.method !== "DELETE") {
        methodNotAllowed(response);
        return;
      }

      const parsedBody = request.method === "POST" ? await readJsonBody(request) : undefined;
      const sessionId = normalizeSessionId(request.headers["mcp-session-id"]);
      let session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session) {
        if (sessionId) {
          notFound(response);
          return;
        }
        if (request.method !== "POST" || !isInitializeRequest(parsedBody)) {
          badRequest(response);
          return;
        }
        session = await createSession();
      }

      const previousSessionId = session.transport.sessionId;
      await session.transport.handleRequest(request, response, parsedBody);
      const nextSessionId = session.transport.sessionId;
      if (!previousSessionId && nextSessionId) sessions.set(nextSessionId, session);
    } catch (error) {
      if (!response.headersSent) internalServerError(response);
      if (!closed) {
        const message = error instanceof Error ? error.message : "Unknown HTTP server failure";
        process.stderr.write(message + "\n");
      }
    }
  });

  try {
    await listen(httpServer, host, port);
  } catch (error) {
    await toolset.close();
    throw error;
  }

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    await closeServer(httpServer).catch(() => undefined);
    await toolset.close();
    throw new Error("Unable to resolve MCP HTTP server address");
  }

  return {
    url: new URL(path, `http://${host}:${address.port}`).toString(),
    close: async () => {
      if (closed) return;
      closed = true;
      await closeServer(httpServer).catch(() => undefined);
      await Promise.allSettled(Array.from(allSessions, (session) => session.close()));
      await toolset.close();
    },
  };
}
