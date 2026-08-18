import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildViewerHtml,
  loadSnapshot,
  pairSessions,
  writeViewer,
} from "./build_results_viewer.mjs";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "viewer-snapshot");

test("loads and validates an exported snapshot", async () => {
  const snapshot = await loadSnapshot(fixtureDir);
  assert.equal(snapshot.sessions.length, 3);
  assert.equal(snapshot.responses.length, 3);
  assert.equal(snapshot.trajectories.length, 3);
  assert.equal(snapshot.trajectories[0].task, "visual_similarity");
  assert.deepEqual(snapshot.trajectories[2].points, [
    { elapsedMs: 0, xPx: 540, yPx: 337 },
    { elapsedMs: 1800, xPx: 700, yPx: 300 },
  ]);
});

test("pairs human and agent sessions while retaining unpaired sessions", async () => {
  const snapshot = await loadSnapshot(fixtureDir);
  const pairs = pairSessions(snapshot);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].human.sessionId.startsWith("dev_human"), true);
  assert.equal(pairs[0].agent.sessionId.startsWith("dev_agent"), true);
  assert.equal(pairs[1].human, null);
  assert.equal(pairs[1].agent.sessionId.startsWith("ops_agent"), true);
});

test("embeds escaped data and comparison controls in standalone HTML", async () => {
  const snapshot = await loadSnapshot(fixtureDir);
  const html = buildViewerHtml(snapshot);
  assert.match(html, /id="results-data"/);
  assert.match(html, /id="human-panel"/);
  assert.match(html, /id="agent-panel"/);
  assert.match(html, /trajectory-svg/);
  assert.match(html, /participant type/i);
  assert.equal(html.includes("</script><script>alert"), false);
  assert.equal(html.includes("fetch("), false);
  assert.match(html, /dev_human_001/);
});

test("writes the viewer to a requested output path", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "results-viewer-test-"));
  const output = join(outputDir, "nested", "viewer.html");
  await writeViewer(fixtureDir, output);
  const html = await readFile(output, "utf8");
  assert.match(html, /Human vs agent/);
});
