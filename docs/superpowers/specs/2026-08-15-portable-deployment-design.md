# Portable Deployment Design

## Goal

Make the shared Vite experiment deployable to static hosting platforms and
provider-backed results services while retaining the existing local Vite run,
same human/agent browser implementation, and screenshot-only agent boundary.

## URL Contract

The application is a single-page app with one `index.html` entry point. The
task is selected only from the pathname:

```text
/tasks/visual-similarity
/tasks/object-matching
```

Launch metadata remains query-string data. The canonical run selector is:

```text
run=development
run=production
```

An absent `run` parameter means `production`, preserving the current full-run
default. `mode=development` remains supported as a compatibility alias.

Examples:

```text
/tasks/visual-similarity?run=development&observer=human&participant_id=P001
/tasks/object-matching?observer=agent&provider=bedrock&model=model-id&agent_name=agent-run
```

Unknown task paths must render a participant-safe unavailable screen; they must
not fall back to a different task. A session ID is run metadata and never
selects task code.

## Static Assets

Deployable manifests and stimuli will live under Vite's public directory:

```text
public/data/dreamsim_100/
public/data/rs_imagenet_100/
```

They retain their existing public URLs, such as
`/data/dreamsim_100/data_100_web.csv`. This makes the built `dist` directory
self-contained for static hosts. The Vite development server will therefore
serve the same URLs without its bespoke dataset middleware.

Source datasets and preparation scripts remain under `data/`; only generated,
browser-deployable assets are copied to `public/data/`.

## Results Boundary

The browser remains backend-agnostic and submits complete session payloads to:

```text
POST /api/experiments/sessions
Idempotency-Key: <session_id>
```

The endpoint defaults to that same-origin URL. An optional Vite build-time
environment variable, `VITE_RESULTS_ENDPOINT`, may supply an absolute endpoint
for a static host with a separately deployed API. The frontend imports no
Firebase SDK or provider-specific code.

Results providers are responsible for request validation, idempotency, and
atomic persistence. Browser-local recovery and JSON downloads stay in place as
the failure fallback.

Firebase is a supported provider example: Firebase Hosting serves the static
SPA and rewrites `/api/experiments/sessions` to a Cloud Function, which writes
to Firestore. Other platforms implement the same HTTP contract through their
function/serverless mechanisms.

## Hosting Configuration

Add deployment configuration/reference files for:

- generic static SPA hosts;
- Firebase Hosting plus a function rewrite;
- Netlify;
- Vercel;
- Cloudflare Pages.

Each configuration must rewrite task paths to `/index.html` while allowing
existing files, including `/data/**` and built assets, to be served directly.
The provider-specific API implementation is intentionally outside the shared
browser package.

## Local Development

`npm run dev` continues to support the same URLs, serve public datasets, and
persist results to the repository's existing local results layout through the
Vite-only development endpoint. `npm run build` produces a static `dist`
directory suitable for deployment to any configured static host.

## Testing

Add tests for:

- known and unknown pathname-to-task resolution;
- `run=development`, `run=production`, omitted-run production default, and
  legacy `mode=development` compatibility;
- resolution of the default versus configured results endpoint;
- presence of deployable manifests in the build output; and
- unchanged local results persistence behavior.

The visual agent model must receive only screenshots and public instructions.
No answer keys, private trial state, or agent-controller internals may appear
in agent observations, prompts, model requests, URLs or filenames supplied to
the model, or its action interface. Static browser assets remain governed by
the existing screenshot-only boundary.

## Scope Limits

This change does not deploy a Firebase project, create cloud credentials,
modify task scoring, or add a production database implementation. It prepares
the repository and HTTP boundary so a provider adapter can be deployed without
changing shared task code.
