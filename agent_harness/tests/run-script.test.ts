import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("agent harness shell runner", () => {
  it("documents the task, model, and run-mode choices", async () => {
    const repositoryRoot = resolve("..");
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
    const repositoryRoot = resolve("..");
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
    const repositoryRoot = resolve("..");
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
