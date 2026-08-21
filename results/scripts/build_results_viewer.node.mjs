import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  buildViewerHtml,
  loadSnapshot,
  participantSessions,
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

test("lists human and agent participant sessions independently", async () => {
  const snapshot = await loadSnapshot(fixtureDir);
  const humans = participantSessions(snapshot, undefined, "human");
  const agents = participantSessions(snapshot, undefined, "agent");
  assert.equal(humans.length, 1);
  assert.equal(agents.length, 2);
  assert.equal(agents.some((session) => session.sessionId.startsWith("ops_agent")), true);
});

test("orders participant ID dropdowns numerically", () => {
  const sessions = ["12", "1", "11", "2"].map((participantId) => ({
    sessionId: `ops_agent_${participantId}_20260820T000000Z_${participantId}`,
    participantId,
    participantType: "agent",
    model: "google/gemini",
    runMode: "ops",
  }));
  const snapshot = {
    manifest: {},
    sessions,
    responses: sessions.map((session) => ({
      sessionId: session.sessionId,
      task: "visual_similarity",
      trialId: "1",
    })),
    trajectories: [],
  };
  const dom = new JSDOM(buildViewerHtml(snapshot), { runScripts: "dangerously" });
  const options = [...dom.window.document.querySelectorAll("#agent-id-filter option")]
    .map((option) => option.textContent);

  assert.deepEqual(options, ["1", "2", "11", "12"]);
  dom.window.close();
});

test("embeds escaped data and comparison controls in standalone HTML", async () => {
  const snapshot = await loadSnapshot(fixtureDir);
  const html = buildViewerHtml(snapshot);
  assert.match(html, /id="results-data"/);
  assert.match(html, /id="human-panel"/);
  assert.match(html, /id="agent-panel"/);
  assert.match(html, /trajectory-svg/);
  assert.match(html, /Human participant ID/);
  assert.match(html, /Agent participant ID/);
  assert.equal(html.includes("Session pair"), false);
  assert.equal(html.includes("Unpaired"), false);
  assert.match(html, /human-id-filter/);
  assert.match(html, /agent-id-filter/);
  assert.equal(html.includes("human correct / RT"), false);
  assert.match(html, /originX/);
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
