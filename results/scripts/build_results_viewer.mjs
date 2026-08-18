#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function normalizePoint(point) {
  if (Array.isArray(point) && point.length === 3) {
    const [elapsedMs, xPx, yPx] = point;
    return { elapsedMs, xPx, yPx };
  }
  if (isObject(point)) {
    return { elapsedMs: point.elapsedMs, xPx: point.xPx, yPx: point.yPx };
  }
  return null;
}

function normalizeTrajectory(trajectory) {
  return {
    ...trajectory,
    points: Array.isArray(trajectory.points)
      ? trajectory.points.map(normalizePoint).filter((point) => point !== null)
      : [],
  };
}

export async function loadSnapshot(inputDir) {
  const input = resolve(inputDir);
  const [manifest, sessions, responses, trajectories] = await Promise.all([
    readJson(resolve(input, "manifest.json")),
    readJson(resolve(input, "sessions.json")),
    readJson(resolve(input, "responses.json")),
    readJson(resolve(input, "trajectories.json")),
  ]);
  if (!isObject(manifest) || !Array.isArray(sessions) || !Array.isArray(responses) || !Array.isArray(trajectories)) {
    throw new Error("Snapshot must contain manifest object and sessions, responses, and trajectories arrays");
  }
  for (const session of sessions) {
    if (!isObject(session) || typeof session.sessionId !== "string") throw new Error("Each session must have a sessionId");
  }
  for (const response of responses) {
    if (!isObject(response) || typeof response.sessionId !== "string" || typeof response.trialId !== "string") {
      throw new Error("Each response must have sessionId and trialId");
    }
  }
  for (const trajectory of trajectories) {
    if (!isObject(trajectory) || typeof trajectory.sessionId !== "string" || typeof trajectory.trialId !== "string") {
      throw new Error("Each trajectory must have sessionId and trialId");
    }
  }
  return { manifest, sessions, responses, trajectories: trajectories.map(normalizeTrajectory) };
}

function sessionTaskSet(snapshot, sessionId) {
  return new Set(snapshot.responses.filter((response) => response.sessionId === sessionId).map((response) => response.task));
}

function pairKey(session) {
  return [session.runMode ?? "", session.participantId ?? ""].join("|");
}

export function pairSessions(snapshot, task) {
  const sessions = snapshot.sessions.filter((session) => !task || sessionTaskSet(snapshot, session.sessionId).has(task));
  const groups = new Map();
  for (const session of sessions) {
    const key = pairKey(session);
    if (!groups.has(key)) groups.set(key, { key, humans: [], agents: [] });
    const group = groups.get(key);
    if (session.participantType === "human") group.humans.push(session);
    if (session.participantType === "agent") group.agents.push(session);
  }
  const pairs = [];
  for (const group of groups.values()) {
    const count = Math.max(group.humans.length, group.agents.length);
    for (let index = 0; index < count; index += 1) {
      pairs.push({
        key: `${group.key}|${index + 1}`,
        human: group.humans[index] ?? null,
        agent: group.agents[index] ?? null,
      });
    }
  }
  return pairs.sort((left, right) => left.key.localeCompare(right.key));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function embeddedData(snapshot) {
  return JSON.stringify(snapshot)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function buildViewerHtml(snapshot) {
  const data = embeddedData(snapshot);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Human vs agent results</title>
  <style>
    :root { color-scheme: light; --ink:#1d2923; --muted:#627067; --line:#d8e0da; --surface:#f5f8f5; --human:#277c63; --agent:#a45726; --accent:#355f8d; }
    * { box-sizing:border-box; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color:var(--ink); background:#fff; }
    main { max-width:1500px; margin:0 auto; padding:24px; }
    h1 { margin:0 0 4px; font-size:26px; font-weight:600; }
    h2 { margin:0 0 12px; font-size:17px; font-weight:600; }
    .subtle { color:var(--muted); font-size:13px; }
    .controls { display:flex; flex-wrap:wrap; gap:12px; margin:20px 0; padding:14px; background:var(--surface); border:1px solid var(--line); }
    label { display:flex; flex-direction:column; gap:4px; color:var(--muted); font-size:12px; font-weight:600; }
    select { min-width:150px; padding:7px 9px; color:var(--ink); background:#fff; border:1px solid #bfcac1; border-radius:4px; font:inherit; }
    .compare { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    .panel { min-width:0; border:1px solid var(--line); padding:14px; }
    .panel.human { border-top:3px solid var(--human); }
    .panel.agent { border-top:3px solid var(--agent); }
    .panel.unpaired { border-top-color:#8d9890; }
    .meta { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:9px; margin:12px 0; }
    .metric { padding:9px; background:var(--surface); border:1px solid var(--line); }
    .metric b { display:block; font-size:18px; font-weight:600; }
    .metric span { color:var(--muted); font-size:11px; }
    .chart { margin-top:16px; border-top:1px solid var(--line); padding-top:14px; }
    svg { display:block; width:100%; height:auto; background:#fbfcfb; border:1px solid var(--line); }
    .legend { display:flex; gap:16px; margin:8px 0; color:var(--muted); font-size:12px; }
    .dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:4px; }
    .table-wrap { overflow-x:auto; margin-top:16px; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    th, td { padding:8px; border-bottom:1px solid var(--line); text-align:left; white-space:nowrap; }
    th { color:var(--muted); font-weight:600; }
    .empty { color:var(--muted); padding:28px 4px; text-align:center; }
    @media (max-width: 800px) { main { padding:14px; } .compare { grid-template-columns:1fr; } .meta { grid-template-columns:repeat(3, 1fr); } }
    @media (max-width: 480px) { .meta { grid-template-columns:1fr; } select { width:100%; } label { width:100%; } }
  </style>
</head>
<body>
<main id="results-viewer">
  <h1>Human vs agent</h1>
  <div class="subtle" id="export-meta"></div>
  <div class="controls" aria-label="Viewer filters">
    <label>Task<select id="task-filter"></select></label>
    <label>Run mode<select id="run-filter"><option value="all">All</option><option value="dev">dev</option><option value="ops">ops</option></select></label>
    <label>Participant type<select id="participant-filter"><option value="both">Human + agent</option><option value="human">Human only</option><option value="agent">Agent only</option></select></label>
    <label>Model<select id="model-filter"><option value="all">All models</option></select></label>
    <label>Session pair<select id="pair-filter"></select></label>
    <label>Trial<select id="trial-filter"><option value="all">All trials</option></select></label>
  </div>
  <div id="comparison">
    <div id="human-panel" hidden></div>
    <div id="agent-panel" hidden></div>
  </div>
</main>
<script type="application/json" id="results-data">${data}</script>
<script>
(() => {
  const DATA = JSON.parse(document.getElementById("results-data").textContent);
  const $ = (id) => document.getElementById(id);
  const byId = new Map(DATA.sessions.map((session) => [session.sessionId, session]));
  const taskSet = [...new Set(DATA.responses.map((row) => row.task).filter(Boolean))].sort();
  const modelSet = [...new Set(DATA.sessions.map((session) => session.model).filter(Boolean))].sort();
  const responseRows = (sessionId, task) => DATA.responses.filter((row) => row.sessionId === sessionId && (!task || row.task === task));
  const trajectoryRows = (sessionId, task) => DATA.trajectories.filter((row) => row.sessionId === sessionId && (!task || row.task === task));
  const taskForSession = (sessionId, task) => responseRows(sessionId, task).length > 0;
  const keyFor = (session) => [session.runMode || "", session.participantId || ""].join("|");
  function pairsFor(task) {
    const groups = new Map();
    DATA.sessions.filter((session) => taskForSession(session.sessionId, task)).forEach((session) => {
      const key = keyFor(session);
      if (!groups.has(key)) groups.set(key, { key, humans: [], agents: [] });
      const group = groups.get(key);
      if (session.participantType === "human") group.humans.push(session);
      if (session.participantType === "agent") group.agents.push(session);
    });
    const pairs = [];
    groups.forEach((group) => {
      const count = Math.max(group.humans.length, group.agents.length);
      for (let index = 0; index < count; index += 1) pairs.push({ key: group.key + "|" + (index + 1), human: group.humans[index] || null, agent: group.agents[index] || null });
    });
    return pairs.sort((a, b) => a.key.localeCompare(b.key));
  }
  const esc = (value) => String(value == null ? "" : value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const mean = (rows, field) => { const values = rows.map((row) => number(row[field])).filter((value) => value !== null); return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; };
  const accuracy = (rows) => { const values = rows.filter((row) => typeof row.correct === "boolean"); return values.length ? values.filter((row) => row.correct).length / values.length : null; };
  const fmt = (value, suffix) => value === null ? "—" : value.toFixed(value % 1 ? 1 : 0) + (suffix || "");
  const points = (trajectory) => (trajectory && Array.isArray(trajectory.points) ? trajectory.points : []).map((point) => Array.isArray(point) ? { elapsedMs: point[0], xPx: point[1], yPx: point[2] } : point).filter((point) => number(point.xPx) !== null && number(point.yPx) !== null);
  const color = (type) => type === "human" ? "#277c63" : "#a45726";
  function responseSvg(rows, maxX, maxY) {
    const width = 560, height = 190, pad = 24;
    const marks = rows.filter((row) => number(row.responseX) !== null && number(row.responseY) !== null).map((row) => {
      const x = pad + row.responseX / maxX * (width - pad * 2);
      const y = pad + row.responseY / maxY * (height - pad * 2);
      return '<circle cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="5" fill="' + color(byId.get(row.sessionId)?.participantType) + '"><title>Trial ' + esc(row.trialId) + '</title></circle>';
    }).join("");
    return '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Response coordinates"><path d="M' + pad + ' ' + pad + 'V' + (height - pad) + 'H' + (width - pad) + '" fill="none" stroke="#c8d2ca"/><text x="' + pad + '" y="' + (height - 5) + '" fill="#627067" font-size="11">0</text><text x="' + (width - pad) + '" y="' + (height - 5) + '" text-anchor="end" fill="#627067" font-size="11">' + maxX + ' px</text>' + marks + '</svg>';
  }
  function trajectorySvg(rows, maxX, maxY) {
    const width = 560, height = 240, pad = 18;
    const paths = rows.map((trajectory) => {
      const raw = points(trajectory); if (!raw.length) return "";
      const coords = raw.map((point) => [(pad + point.xPx / maxX * (width - pad * 2)).toFixed(2), (pad + point.yPx / maxY * (height - pad * 2)).toFixed(2)]);
      const d = coords.map((coord, index) => (index ? "L" : "M") + coord[0] + " " + coord[1]).join(" ");
      const start = coords[0], end = coords[coords.length - 1];
      const type = byId.get(trajectory.sessionId)?.participantType;
      return '<path d="' + d + '" fill="none" stroke="' + color(type) + '" stroke-width="2" opacity=".82"/><circle cx="' + start[0] + '" cy="' + start[1] + '" r="4" fill="' + color(type) + '"/><path d="M' + (Number(end[0]) - 5) + ' ' + (Number(end[1]) - 5) + 'L' + (Number(end[0]) + 5) + ' ' + (Number(end[1]) + 5) + 'M' + (Number(end[0]) + 5) + ' ' + (Number(end[1]) - 5) + 'L' + (Number(end[0]) - 5) + ' ' + (Number(end[1]) + 5) + '" stroke="' + color(type) + '" stroke-width="2"/>';
    }).join("");
    return '<svg class="trajectory-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Raw pointer trajectories"><path d="M' + pad + ' ' + pad + 'V' + (height - pad) + 'H' + (width - pad) + '" fill="none" stroke="#c8d2ca"/>' + paths + '</svg>';
  }
  function panel(session, task, selectedTrial, label) {
    if (!session) return '<section class="panel unpaired"><h2>' + label + '</h2><div class="empty">Unpaired — no matching session</div></section>';
    const rows = responseRows(session.sessionId, task).filter((row) => selectedTrial === "all" || row.trialId === selectedTrial);
    const trajectories = trajectoryRows(session.sessionId, task).filter((row) => selectedTrial === "all" || row.trialId === selectedTrial);
    const acc = accuracy(rows), rt = mean(rows, "reactionTimeMs");
    const maxX = Math.max(1080, ...rows.map((row) => number(row.responseX) || 0));
    const maxY = Math.max(675, ...rows.map((row) => number(row.responseY) || 0));
    const table = rows.map((row) => '<tr><td>' + esc(row.trialId) + '</td><td>' + (typeof row.correct === "boolean" ? (row.correct ? "correct" : "incorrect") : "—") + '</td><td>' + fmt(number(row.reactionTimeMs), " ms") + '</td><td>' + (number(row.responseX) === null ? "—" : number(row.responseX) + ", " + number(row.responseY)) + '</td></tr>').join("");
    return '<section class="panel ' + session.participantType + '" id="' + session.participantType + '-panel"><h2>' + label + '</h2><div class="subtle">' + esc(session.sessionId) + '<br>model: ' + esc(session.model) + ' · run: ' + esc(session.runMode) + '</div><div class="meta"><div class="metric"><b>' + fmt(acc === null ? null : acc * 100, "%") + '</b><span>accuracy</span></div><div class="metric"><b>' + fmt(rt, " ms") + '</b><span>mean reaction time</span></div><div class="metric"><b>' + rows.length + '</b><span>responses</span></div></div><div class="chart"><div class="subtle">Response coordinates</div>' + responseSvg(rows, maxX, maxY) + '</div><div class="chart"><div class="subtle">Raw trajectories · start dot, end X</div>' + trajectorySvg(trajectories, maxX, maxY) + '</div><div class="table-wrap"><table><thead><tr><th>trial</th><th>correct</th><th>reaction</th><th>x, y</th></tr></thead><tbody>' + (table || '<tr><td colspan="4">No matching response</td></tr>') + '</tbody></table></div></section>';
  }
  function render() {
    const task = $("task-filter").value;
    const run = $("run-filter").value;
    const participant = $("participant-filter").value;
    const model = $("model-filter").value;
    const pairs = pairsFor(task).filter((pair) => {
      const candidate = pair.human || pair.agent;
      return candidate && (run === "all" || candidate.runMode === run) && (model === "all" || (pair.agent && pair.agent.model === model));
    });
    const pairIndex = Math.min(Number($("pair-filter").value || 0), Math.max(0, pairs.length - 1));
    const pair = pairs[pairIndex] || { human: null, agent: null };
    const selectedTrial = $("trial-filter").value;
    const html = [];
    if (participant !== "agent") html.push(panel(pair.human, task, selectedTrial, "Human"));
    if (participant !== "human") html.push(panel(pair.agent, task, selectedTrial, "Agent"));
    $("comparison").innerHTML = '<div class="legend"><span><i class="dot" style="background:#277c63"></i>human</span><span><i class="dot" style="background:#a45726"></i>agent</span></div><div class="compare">' + html.join("") + '</div><div class="table-wrap"><table><thead><tr><th>trial</th><th>human correct / RT</th><th>agent correct / RT</th></tr></thead><tbody>' + comparisonRows(pair, task, selectedTrial) + '</tbody></table></div>';
  }
  function comparisonRows(pair, task, selectedTrial) {
    const humanRows = pair.human ? responseRows(pair.human.sessionId, task) : [];
    const agentRows = pair.agent ? responseRows(pair.agent.sessionId, task) : [];
    const ids = [...new Set([...humanRows, ...agentRows].map((row) => row.trialId))].filter((id) => selectedTrial === "all" || id === selectedTrial).sort();
    return ids.map((id) => {
      const human = humanRows.find((row) => row.trialId === id), agent = agentRows.find((row) => row.trialId === id);
      const cell = (row) => row ? (typeof row.correct === "boolean" ? (row.correct ? "correct" : "incorrect") : "—") + " / " + fmt(number(row.reactionTimeMs), " ms") : "—";
      return '<tr><td>' + esc(id) + '</td><td>' + cell(human) + '</td><td>' + cell(agent) + '</td></tr>';
    }).join("") || '<tr><td colspan="3">No paired trials</td></tr>';
  }
  function refreshOptions() {
    const task = $("task-filter").value;
    const pairs = pairsFor(task);
    $("pair-filter").innerHTML = pairs.map((pair, index) => '<option value="' + index + '">' + esc(pair.key) + (pair.human && pair.agent ? " · paired" : " · unpaired") + '</option>').join("") || '<option value="0">No sessions</option>';
    const currentPair = pairs[Math.min(Number($("pair-filter").value || 0), Math.max(0, pairs.length - 1))];
    const ids = currentPair ? [...new Set([...(currentPair.human ? responseRows(currentPair.human.sessionId, task) : []), ...(currentPair.agent ? responseRows(currentPair.agent.sessionId, task) : [])].map((row) => row.trialId))].sort() : [];
    $("trial-filter").innerHTML = '<option value="all">All trials</option>' + ids.map((id) => '<option value="' + esc(id) + '">' + esc(id) + '</option>').join("");
    render();
  }
  $("export-meta").textContent = "Exported " + (DATA.manifest.exportedAt || "unknown") + " · " + (DATA.manifest.counts?.sessions || 0) + " sessions · " + (DATA.manifest.counts?.responses || 0) + " responses · " + (DATA.manifest.counts?.trajectories || 0) + " trajectories";
  $("task-filter").innerHTML = taskSet.map((task) => '<option value="' + esc(task) + '">' + esc(task.replaceAll("_", " ")) + '</option>').join("");
  $("model-filter").innerHTML += modelSet.map((model) => '<option value="' + esc(model) + '">' + esc(model) + '</option>').join("");
  ["task-filter", "run-filter", "participant-filter", "model-filter", "pair-filter", "trial-filter"].forEach((id) => $(id).addEventListener("change", () => id === "task-filter" || id === "run-filter" || id === "model-filter" ? refreshOptions() : render()));
  refreshOptions();
})();
</script>
</body>
</html>
`;
}

export async function writeViewer(inputDir, outputPath) {
  const snapshot = await loadSnapshot(inputDir);
  const output = resolve(outputPath);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, buildViewerHtml(snapshot), "utf8");
  return output;
}

export function usage() {
  return [
    "Usage: node results/scripts/build_results_viewer.mjs --input <snapshot-folder> --output <html-file>",
    "The generated HTML is self-contained and reads no network resources.",
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help")) {
    console.log(usage());
    return 0;
  }
  let input;
  let output;
  try {
    for (let index = 0; index < argv.length; index += 1) {
      const argument = argv[index];
      const value = argv[index + 1];
      if (argument === "--input" && value && !value.startsWith("--")) { input = value; index += 1; }
      else if (argument === "--output" && value && !value.startsWith("--")) { output = value; index += 1; }
      else throw new Error(`Unexpected argument: ${argument}`);
    }
    if (!input) throw new Error("--input is required");
    if (!output) throw new Error("--output is required");
    console.log(await writeViewer(input, output));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Viewer generation failed");
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main();
