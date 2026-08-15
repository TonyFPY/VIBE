# Portable Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the experiment a portable single-page application whose task and run are URL-selected, whose deployable stimuli are included in the Vite build, and whose results submission stays backend-agnostic.

**Architecture:** Extract URL parsing into a shared module so bootstrap consumes a validated task ID and run mode. Preserve the browser submission contract while resolving its endpoint from an optional Vite environment variable. Move browser-only stimulus subsets into Vite’s `public/data` tree and add host rewrite templates that serve the existing `index.html` shell for task URLs.

**Tech Stack:** Vite 6, TypeScript 5, Vitest 3, jsPsych 8, Firebase Hosting configuration, and static-host configuration for Netlify, Vercel, and Cloudflare Pages.

## Global Constraints

- Keep one shared Vite/jsPsych implementation for human and screenshot-only agent observers.
- Select task only from `/tasks/<task-name>`; session identity must never select task code.
- Omitted `run` means full production; `run=development` is the short run; `mode=development` remains compatible.
- Default submission remains `POST /api/experiments/sessions` with `Idempotency-Key: <session_id>`.
- Do not add Firebase SDK code, cloud credentials, paid services, or provider-specific browser code.
- Keep `npm run dev` local results persistence; do not touch the user’s stylesheet edit.
- The visual agent model receives screenshots and public instructions only; browser assets and private client state must not be passed into model observations, prompts, URLs, filenames, or tool interfaces.

---

### Task 1: Centralize task-route and run parsing

**Files:**
- Create: `tasks/shared/app/launch.ts`
- Create: `tasks/shared/app/launch.test.ts`
- Modify: `tasks/shared/app/main.ts`

**Interfaces:**
- Produces `parseLaunch(pathname: string, search: string): Launch`.
- `Launch = { task: "visual-similarity" | "object-matching"; runMode: "development" | "full" | "trace-smoke" }`.
- Produces `runModeFromSearch(search: string): LaunchRunMode`.
- Unknown task paths throw `Error("Unknown task route")`; `main.ts` presents that through its existing safe startup error UI.

- [ ] **Step 1: Write the failing tests**

Create `tasks/shared/app/launch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseLaunch, runModeFromSearch } from "./launch";

describe("launch parsing", () => {
  it("selects visual similarity and defaults to the full run", () => {
    expect(parseLaunch("/tasks/visual-similarity", "")).toEqual({
      task: "visual-similarity", runMode: "full",
    });
  });

  it("selects object matching and canonical development mode", () => {
    expect(parseLaunch("/tasks/object-matching", "?run=development")).toEqual({
      task: "object-matching", runMode: "development",
    });
  });

  it("accepts the legacy development selector", () => {
    expect(runModeFromSearch("?mode=development")).toBe("development");
  });

  it("keeps trace smoke explicit and treats other values as full", () => {
    expect(runModeFromSearch("?run=trace-smoke")).toBe("trace-smoke");
    expect(runModeFromSearch("?run=preview")).toBe("full");
  });

  it("rejects undeclared task routes", () => {
    expect(() => parseLaunch("/tasks/not-a-task", "")).toThrow("Unknown task route");
  });
});
```

- [ ] **Step 2: Verify the test is red**

Run: `npm test -- tasks/shared/app/launch.test.ts`

Expected: FAIL because `./launch` does not exist.

- [ ] **Step 3: Implement the minimal parser and consume it**

Create `launch.ts`:

```ts
export type TaskRoute = "visual-similarity" | "object-matching";
export type LaunchRunMode = "development" | "full" | "trace-smoke";
export interface Launch { task: TaskRoute; runMode: LaunchRunMode; }

export function runModeFromSearch(search: string): LaunchRunMode {
  const params = new URLSearchParams(search);
  const value = params.get("run") ?? params.get("mode");
  return value === "development" || value === "trace-smoke" ? value : "full";
}

export function parseLaunch(pathname: string, search: string): Launch {
  const task = pathname.replace(/^\/tasks\//, "");
  if (task !== "visual-similarity" && task !== "object-matching") {
    throw new Error("Unknown task route");
  }
  return { task, runMode: runModeFromSearch(search) };
}
```

In `main.ts`, call `parseLaunch(window.location.pathname, window.location.search)`, map its `runMode` to the existing task run types, and choose startup by `launch.task`. Remove direct inline pathname/mode parsing. Leave `createSessionIdentity` responsible only for observer identity fields.

- [ ] **Step 4: Verify green**

Run: `npm test -- tasks/shared/app/launch.test.ts tasks/shared/experiment/session.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tasks/shared/app/launch.ts tasks/shared/app/launch.test.ts tasks/shared/app/main.ts
git commit -m "feat: route experiments by task and run URL"
```

### Task 2: Configure the provider-neutral results endpoint

**Files:**
- Create: `tasks/shared/experiment/persistence.test.ts`
- Modify: `tasks/shared/experiment/persistence.ts`
- Create: `.env.example`

**Interfaces:**
- Produces `resultsEndpoint(environment?: Record<string, string | undefined>): string`.
- `submitSession(payload, endpoint = resultsEndpoint())` retains its current headers, JSON body, and non-OK response error.
- `VITE_RESULTS_ENDPOINT` is optional; the empty or missing value resolves to the existing same-origin endpoint.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { resultsEndpoint } from "./persistence";

describe("results endpoint", () => {
  it("uses the same-origin API by default", () => {
    expect(resultsEndpoint({})).toBe("/api/experiments/sessions");
  });

  it("uses a configured endpoint for a separately deployed API", () => {
    expect(resultsEndpoint({ VITE_RESULTS_ENDPOINT: "https://api.example.test/sessions" }))
      .toBe("https://api.example.test/sessions");
  });

  it("ignores an empty configured endpoint", () => {
    expect(resultsEndpoint({ VITE_RESULTS_ENDPOINT: "" })).toBe("/api/experiments/sessions");
  });
});
```

- [ ] **Step 2: Verify the test is red**

Run: `npm test -- tasks/shared/experiment/persistence.test.ts`

Expected: FAIL because `resultsEndpoint` is not exported.

- [ ] **Step 3: Implement endpoint resolution**

Add:

```ts
const defaultResultsEndpoint = "/api/experiments/sessions";

export function resultsEndpoint(
  environment: Record<string, string | undefined> = import.meta.env,
): string {
  return environment.VITE_RESULTS_ENDPOINT?.trim() || defaultResultsEndpoint;
}
```

Change `submitSession`’s default `endpoint` argument to `resultsEndpoint()`. Create `.env.example`:

```dotenv
# Optional absolute endpoint for a separately deployed results API.
# Unset means POST /api/experiments/sessions on this host.
VITE_RESULTS_ENDPOINT=
```

- [ ] **Step 4: Verify green**

Run: `npm test -- tasks/shared/experiment/persistence.test.ts tasks/shared/experiment/local-results.test.ts`

Expected: PASS; local disk persistence paths are unchanged.

- [ ] **Step 5: Commit**

```bash
git add tasks/shared/experiment/persistence.ts tasks/shared/experiment/persistence.test.ts .env.example
git commit -m "feat: configure deployment results endpoint"
```

### Task 3: Package web stimuli in Vite public assets

**Files:**
- Move: `data/dreamsim_100/` → `public/data/dreamsim_100/`
- Move: `data/rs_imagenet_100/` → `public/data/rs_imagenet_100/`
- Modify: `data/dreamsim/prepare_web_stimuli.py`
- Modify: `data/rs_imagenet/prepare_web_subset.py`
- Modify: `vite.config.ts`
- Create: `tasks/shared/app/deploy-assets.test.ts`
- Modify: `docs/visual_similarity.md`
- Modify: `docs/object_matching.md`

**Interfaces:**
- Existing public asset URLs, such as `/data/dreamsim_100/data_100_web.csv`, remain unchanged.
- Generated assets are canonical under `public/data`; original sources remain under ignored `data/dreamsim` and `data/rs_imagenet`.
- Vite automatically serves those files locally and copies them to `dist/data`; only the local results middleware remains in `vite.config.ts`.

- [ ] **Step 1: Write the failing public-asset tests**

```ts
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

describe("deployable experiment assets", () => {
  it("keeps the visual-similarity manifest in Vite public data", () => {
    expect(existsSync(resolve(root, "public/data/dreamsim_100/data_100_web.csv"))).toBe(true);
  });

  it("keeps the object-matching manifest in Vite public data", () => {
    expect(existsSync(resolve(root, "public/data/rs_imagenet_100/data_web_100.csv"))).toBe(true);
  });
});
```

- [ ] **Step 2: Verify the test is red**

Run: `npm test -- tasks/shared/app/deploy-assets.test.ts`

Expected: FAIL because the generated subsets are still under `data/`.

- [ ] **Step 3: Move files and update producers**

Run:

```bash
mkdir -p public/data
git mv data/dreamsim_100 public/data/dreamsim_100
git mv data/rs_imagenet_100 public/data/rs_imagenet_100
```

Change the DreamSim generator’s `DEFAULT_OUTPUT_ROOT` to:

```py
DATA_DIR.parent.parent / "public" / "data" / "dreamsim_100"
```

Change the object-matching generator’s `DEFAULT_OUTPUT_ROOT` to:

```py
DATA_DIR.parent.parent / "public" / "data" / "rs_imagenet_100"
```

Retain its `PUBLIC_ASSET_PREFIX`, so both generated manifests retain their current browser paths. Remove `serveDataset()` and its Node stream/file imports from `vite.config.ts`; preserve `serveLocalResults()` exactly. Update the task docs’ generated-output descriptions and commands.

- [ ] **Step 4: Verify green and inspect build output**

Run: `npm test -- tasks/shared/app/deploy-assets.test.ts && npm run build && test -f dist/data/dreamsim_100/data_100_web.csv && test -f dist/data/rs_imagenet_100/data_web_100.csv`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public data/dreamsim/prepare_web_stimuli.py data/rs_imagenet/prepare_web_subset.py vite.config.ts tasks/shared/app/deploy-assets.test.ts docs/visual_similarity.md docs/object_matching.md
git commit -m "feat: package experiment assets for static hosting"
```

### Task 4: Add host rewrite templates and deployment guide

**Files:**
- Create: `firebase.json`
- Create: `netlify.toml`
- Create: `vercel.json`
- Create: `public/_redirects`
- Create: `docs/deployment.md`
- Create: `tasks/shared/app/hosting-config.test.ts`
- Modify: `README.md`

**Interfaces:**
- Each static host serves `dist/` and rewrites only task navigation to `/index.html`.
- Firebase Hosting configuration is valid for a static-only deployment; Firebase results use a separately deployed Cloud Function endpoint supplied through `VITE_RESULTS_ENDPOINT` until a Firebase Functions package is explicitly added.
- Other provider APIs use their own serverless implementation or `VITE_RESULTS_ENDPOINT`; browser code remains unchanged.

- [ ] **Step 1: Write the failing configuration contract test**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

describe("hosting configuration", () => {
  it("defines Firebase task routing", () => {
    const config = readFileSync(resolve(root, "firebase.json"), "utf8");
    expect(config).toContain('"source": "/tasks/**"');
    expect(config).toContain('"destination": "/index.html"');
  });

  it("ships Netlify, Vercel, and Cloudflare task fallbacks", () => {
    expect(readFileSync(resolve(root, "netlify.toml"), "utf8")).toContain('from = "/tasks/*"');
    expect(readFileSync(resolve(root, "vercel.json"), "utf8")).toContain('"source": "/tasks/(.*)"');
    expect(readFileSync(resolve(root, "public/_redirects"), "utf8")).toContain("/tasks/* /index.html 200");
  });
});
```

- [ ] **Step 2: Verify the test is red**

Run: `npm test -- tasks/shared/app/hosting-config.test.ts`

Expected: FAIL because host configuration files do not exist.

- [ ] **Step 3: Add minimal configurations and documentation**

Create `firebase.json`:

```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      { "source": "/tasks/**", "destination": "/index.html" }
    ]
  }
}
```

Create `netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/tasks/*"
  to = "/index.html"
  status = 200
```

Create `vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/tasks/(.*)", "destination": "/index.html" }]
}
```

Create `public/_redirects`:

```text
/tasks/* /index.html 200
```

Write `docs/deployment.md`: build/local commands; canonical URLs; the HTTP submission schema and idempotency; Firebase Hosting plus separately deployed Cloud Function/Firestore adapter responsibilities; Netlify, Vercel, and Cloudflare function options; `VITE_RESULTS_ENDPOINT`; 135 MB approximate deployable asset volume; access control; no-cheating boundary; and the absence of secrets from source control. State explicitly that the included Firebase file deploys only static hosting and that an API URL must be configured before collecting unattended production data. Update README links and canonical URLs to `run=development`.

- [ ] **Step 4: Verify green**

Run: `npm test -- tasks/shared/app/hosting-config.test.ts && npm run build && test -f dist/_redirects`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add firebase.json netlify.toml vercel.json public/_redirects docs/deployment.md README.md tasks/shared/app/hosting-config.test.ts
git commit -m "docs: add portable experiment deployment guides"
```

### Task 5: Verify local compatibility and complete deployment artifacts

**Files:**
- Modify: `README.md` only if a verification finding makes a documented command inaccurate.

**Interfaces:**
- Confirms tests, static build, task URLs, public asset paths, and Vite-only local persistence all operate without Firebase installed.

- [ ] **Step 1: Run the complete suite**

Run: `npm test`

Expected: PASS across task, session, local persistence, URL, endpoint, public asset, and host configuration tests.

- [ ] **Step 2: Build and check release artifacts**

Run: `npm run build && test -f dist/index.html && test -f dist/data/dreamsim_100/data_100_web.csv && test -f dist/data/rs_imagenet_100/data_web_100.csv && test -f dist/_redirects`

Expected: PASS.

- [ ] **Step 3: Run local Vite smoke checks**

Run: `npm run dev -- --host 127.0.0.1`

Open these normal-browser URLs and confirm each reaches the instruction screen without a manifest error:

```text
http://127.0.0.1:5173/tasks/visual-similarity?run=development&observer=human&participant_id=deploy-check
http://127.0.0.1:5173/tasks/object-matching?run=development&observer=human&participant_id=deploy-check
```

Stop Vite after the smoke check. Complete a development run only if required to recheck local result writes.

- [ ] **Step 4: Check scope and leakage**

Run: `git diff --check && rg -n "firebaseConfig|apiKey" firebase.json netlify.toml vercel.json docs README.md tasks/shared/app tasks/shared/experiment`

Expected: no whitespace errors or credentials; model-facing observations, prompts, URLs, filenames, and tool interfaces continue to omit answer keys and private state.

- [ ] **Step 5: Commit only a necessary final documentation correction**

```bash
git add README.md
git commit -m "docs: verify portable deployment workflow"
```

Skip this step when verification required no documentation correction; never create an empty commit.
