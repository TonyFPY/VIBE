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

Canonical session URLs are:

```text
https://<host>/tasks/visual-similarity?run=dev&participant_id=H001
https://<host>/tasks/object-matching?run=dev&participant_id=H001
https://<host>/tasks/visual-similarity?run=ops&participant_id=H001
https://<host>/tasks/object-matching?run=ops&participant_id=H001
https://<host>/tasks/visual-similarity?run=dev&participant_id=A001&model=gpt-5.6-luna
https://<host>/tasks/object-matching?run=dev&participant_id=A001&model=gpt-5.6-luna
https://<host>/tasks/visual-similarity?run=ops&participant_id=A001&model=gpt-5.6-luna
https://<host>/tasks/object-matching?run=ops&participant_id=A001&model=gpt-5.6-luna

e.g.
<host> is https://vibe-9d6e5.web.app
```

`run=dev` selects the development subset. `run=ops` selects the full operation.
`participant_id=H001` saves participant `001` as type `human`; `A001` saves it
as type `agent`. Agent URLs should include `model`; human sessions save
`model: "None"`. Provider, agent name, and other optional identity parameters
are ignored and never saved.

## Results API

The browser submits one complete JSON session payload using:

```text
POST /api/experiments/sessions
Content-Type: application/json
Idempotency-Key: <session_id>
```

The payload has `session`, `results`, and `trajectories` fields. The `session`
object supplies the compact `sessionId`, `participantId`, `participantType`,
`model`, and `runMode`; `results` contains trial records; and `trajectories` contains
testing pointer samples. The API must validate this schema, use `session_id`
as its idempotency key, and atomically persist the result and trajectory data.
Retries with the same key must not create duplicate sessions.

The API is optional for ops runs. Dev runs automatically use the
same-origin `/api/experiments/sessions` endpoint. If an ops run has no
`VITE_RESULTS_ENDPOINT`, the browser does not make a network request and shows
separate result and trajectory downloads. If an endpoint is configured, the
browser retries a bounded number of times with the same idempotency key and
shows downloads if the API remains unavailable. Local recovery is retained
until the API confirms success.

For a local Vite results handler or separately deployed API, set this build-time
variable before building:

```dotenv
VITE_RESULTS_ENDPOINT=https://api.example.org/experiments/sessions
```

`VITE_RESULTS_ENDPOINT` is a public browser configuration value, not a secret.
The API must enforce its own authentication or signed-run policy, rate limits,
request-size limits, CORS origin allowlist, and storage access controls.

## Hosting templates

`firebase.json` deploys Firebase Hosting together with the configured
`saveSession` Cloud Function rewrite. Deploy the Functions package before
collecting unattended production data. If you use another API instead, build
with its URL in `VITE_RESULTS_ENDPOINT`; the browser contract stays the same.

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

## External agent harness

The Playwright worker lives under [`agent_harness/`](../agent_harness/README.md)
and runs independently from Firebase Hosting and Functions. It opens the same
deployed task URL used by humans, prefixes the numeric participant ID with `A`,
captures viewport JPEGs, calls a selected Gemini API Computer Use model, and
executes only validated pointer actions.

Deploying or running the harness does not require rebuilding the website. Keep
`GEMINI_API_KEY`, private screenshots, and harness JSON Lines logs in the worker
environment. The browser continues to submit behavioral results through its
existing Firebase API; the harness does not duplicate that upload.
