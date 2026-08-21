import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("agent harness shell runner", () => {
  it("documents the task, model, and run-mode choices", async () => {
    const result = await execFileAsync("bash", [resolve(repositoryRoot, "agent_harness/run.sh"), "--help"], {
      cwd: repositoryRoot,
      env: process.env,
    });

    expect(result.stdout).toContain("--task visual-similarity|object-matching");
    expect(result.stdout).toContain("google/gemini-3.7-flash");
    expect(result.stdout).toContain("google/gemini-3.5-flash-lite");
    expect(result.stdout).toContain("google/gemini-3.5-flash");
    expect(result.stdout).toContain("google/gemini-3-flash-preview");
    expect(result.stdout).toContain("--runMode dev|ops");
  });

  it("rejects unsupported task values before starting npm", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "agent-harness-invalid-runner-"));
    const fakeNpm = join(temporaryRoot, "npm");
    await writeFile(fakeNpm, "#!/usr/bin/env node\nprocess.stdout.write('npm-called');\n", "utf8");
    await chmod(fakeNpm, 0o755);
    try {
      await execFileAsync("bash", [
        resolve(repositoryRoot, "agent_harness/run.sh"),
        "--host", "https://vibe-9d6e5.web.app",
        "--task", "unsupported-task",
        "--model", "google/gemini-3.7-flash",
        "--runMode", "dev",
        "--pid", "1",
      ], {
        cwd: repositoryRoot,
        env: { ...process.env, PATH: `${temporaryRoot}:${process.env.PATH ?? ""}` },
      });
      throw new Error("expected run.sh to reject the task");
    } catch (error) {
      expect(String((error as { stderr?: string }).stderr ?? error)).toContain(
        "--task must be visual-similarity or object-matching",
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("uses the repository CLI and forwards the run arguments", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "agent-harness-runner-"));
    const fakeNpm = join(temporaryRoot, "npm");
    await writeFile(fakeNpm, "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n", "utf8");
    await chmod(fakeNpm, 0o755);

    try {
      const result = await execFileAsync("bash", [
        resolve(repositoryRoot, "agent_harness/run.sh"),
        "--host", "https://vibe-9d6e5.web.app",
        "--task", "object-matching",
        "--model", "google/gemini-3.7-flash",
        "--runMode", "ops",
        "--pid", "7",
        "--headed",
      ], {
        cwd: temporaryRoot,
        env: {
          ...process.env,
          PATH: `${temporaryRoot}:${process.env.PATH ?? ""}`,
        },
      });

      expect(JSON.parse(result.stdout)).toEqual([
        "--prefix", resolve(repositoryRoot, "agent_harness"),
        "start", "--",
        "--host", "https://vibe-9d6e5.web.app",
        "--task", "object-matching",
        "--model", "google/gemini-3.7-flash",
        "--runMode", "ops",
        "--pid", "7",
        "--headed",
      ]);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await stat(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("timed out waiting for " + path);
}

describe("Codex MCP worker script", () => {
  it("starts the HTTP worker and writes a private connection manifest", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "codex-mcp-worker-"));
    const fakeNpm = join(temporaryRoot, "npm");
    const capturedEnvironmentPath = join(temporaryRoot, "worker-env.json");
    await writeFile(fakeNpm, `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync(process.env.FAKE_WORKER_ENV, JSON.stringify({
  argv: process.argv.slice(2),
  AGENT_BROWSER_URL: process.env.AGENT_BROWSER_URL,
  AGENT_BROWSER_RUN_ID: process.env.AGENT_BROWSER_RUN_ID,
  AGENT_BROWSER_HEADLESS: process.env.AGENT_BROWSER_HEADLESS,
  AGENT_BROWSER_BEARER_TOKEN: process.env.AGENT_BROWSER_BEARER_TOKEN,
  AGENT_BROWSER_MCP_HOST: process.env.AGENT_BROWSER_MCP_HOST,
  AGENT_BROWSER_MCP_PORT: process.env.AGENT_BROWSER_MCP_PORT,
}));
process.stdout.write("http://127.0.0.1:45678/mcp\\n");
setInterval(() => {}, 1000);
`, "utf8");
    await chmod(fakeNpm, 0o755);

    const runDirectory = join(temporaryRoot, "A46");
    const manifestPath = join(runDirectory, "mcp-connection.json");
    const child = spawn("bash", [
      resolve(repositoryRoot, "scripts/codex-mcp-worker.sh"),
      "--run-dir", runDirectory,
      "--run-id", "A46",
      "--url", "https://vibe-9d6e5.web.app/tasks/object-matching?run=ops&participant_id=A46&model=gpt-5.6-luna-medium",
      "--manifest", manifestPath,
      "--headless", "false",
      "--port", "45678",
    ], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PATH: `${temporaryRoot}:${process.env.PATH ?? ""}`,
        FAKE_WORKER_ENV: capturedEnvironmentPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const childExit = new Promise((resolve) => child.once("exit", resolve));

    try {
      await waitForFile(manifestPath);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const capturedEnvironment = JSON.parse(await readFile(capturedEnvironmentPath, "utf8"));
      const mode = (await stat(manifestPath)).mode & 0o777;

      expect(mode).toBe(0o600);
      expect(Object.keys(manifest).sort()).toEqual(["bearerToken", "pid", "runId", "url"]);
      expect(manifest).toMatchObject({
        url: "http://127.0.0.1:45678/mcp",
        runId: "A46",
      });
      expect(manifest.bearerToken).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.pid).toBeGreaterThan(0);
      expect(capturedEnvironment.argv).toEqual(["--prefix", resolve(repositoryRoot, "agent_harness"), "run", "agent-browser-http"]);
      expect(capturedEnvironment.AGENT_BROWSER_URL).toContain("participant_id=A46");
      expect(capturedEnvironment.AGENT_BROWSER_RUN_ID).toBe("A46");
      expect(capturedEnvironment.AGENT_BROWSER_HEADLESS).toBe("false");
      expect(capturedEnvironment.AGENT_BROWSER_BEARER_TOKEN).toBe(manifest.bearerToken);
      expect(capturedEnvironment.AGENT_BROWSER_MCP_HOST).toBe("127.0.0.1");
      expect(capturedEnvironment.AGENT_BROWSER_MCP_PORT).toBe("45678");
    } finally {
      child.kill("SIGTERM");
      await childExit;
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 10_000);
});
