# Deployment

The built application is a static single-page application. Every supported
host serves `dist/` directly and rewrites only `/tasks/**` navigation to
`/index.html`; assets such as `/data/**` and built JavaScript keep their normal
static paths.

## Build and local run

```sh
npm install
npm run build
npm run dev
```

`npm run dev` runs the local Vite results endpoint as well as the browser
application. It is for local development, not unattended production
collection. `npm run build` creates the deployable `dist/` directory, including
approximately 135 MB of stimulus assets.

Canonical development URLs are:

```text
https://<host>/tasks/visual-similarity?run=development&observer=human&participant_id=P001
https://<host>/tasks/object-matching?run=development&observer=human&participant_id=P001
```

Omit `run=development` for a full run. Agent runs use the same task URLs with
`observer=agent` and their run metadata in the query string.

## Results API

The browser submits one complete JSON session payload using:

```text
POST /api/experiments/sessions
Content-Type: application/json
Idempotency-Key: <session_id>
```

The payload has `session`, `results`, and `trajectories` fields. The `session`
object supplies the unique `sessionId`, observer identity, start timestamp, and
random seed; `results` contains trial records; and `trajectories` contains
testing pointer samples. The API must validate this schema, use `session_id`
as its idempotency key, and atomically persist the result and trajectory data.
Retries with the same key must not create duplicate sessions.

The endpoint defaults to the same-origin path above. For a separately deployed
API, set this build-time variable before building:

```dotenv
VITE_RESULTS_ENDPOINT=https://api.example.org/experiments/sessions
```

`VITE_RESULTS_ENDPOINT` is a public browser configuration value, not a secret.
The API must enforce its own authentication or signed-run policy, rate limits,
request-size limits, CORS origin allowlist, and storage access controls.

## Hosting templates

`firebase.json` deploys **static Firebase Hosting only**. It contains no
Cloud Function rewrite and does not deploy a Functions package. Before
collecting unattended production data on Firebase Hosting, deploy a separate
Cloud Function (or another API) that validates and stores the HTTP contract,
for example in Firestore, then build with its URL in `VITE_RESULTS_ENDPOINT`.

`netlify.toml` configures the build output and task fallback for Netlify.
`vercel.json` provides the equivalent Vercel configuration. `public/_redirects`
is copied into `dist/_redirects` for Netlify and Cloudflare Pages-compatible
static routing. On Netlify, Vercel, or Cloudflare, implement results collection
with that provider's serverless/function service or a separately deployed API;
the browser code stays unchanged and uses `VITE_RESULTS_ENDPOINT` when the API
is on another origin.

Deploy the generated `dist/` directory (or let the provider run `npm run
build`). Do not add a catch-all rewrite: only task navigation should return the
SPA shell so missing assets and API paths remain visible errors.

## Human and agent boundary

Humans and agents use the same rendered task URL and submit the same session
schema. An agent model receives screenshots and public instructions only, then
returns restricted keyboard or pointer actions. Do not expose the DOM,
accessibility tree, trial metadata, answer keys, source files, browser
controller, or results credentials to the model.

Keep secrets out of source control and out of `VITE_*` variables: provider
credentials, database keys, service-account material, and API signing secrets
belong only in the separately deployed API's secret store. No provider SDK,
credential, or provider-specific frontend implementation is required by this
static application.
