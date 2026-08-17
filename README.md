# Visual Behavior Platform

One browser experiment stack for human and screenshot-only visual-agent
observers. See [AGENTS.md](AGENTS.md) for platform rules and the task documents
for experimental details:

- [Visual similarity](docs/visual_similarity.md)
- [Object matching](docs/object_matching.md)
- [Website cursor trajectories](docs/agent_cursor_tracing.md)

## Local setup

From the repository root:

```bash
npm install
npm run dev
```

The local site is then available at `http://127.0.0.1:5173`.

## Human testing

Open one of these URLs in a normal browser. `run=dev` is exactly three training
trials followed by ten testing trials. `run=ops` runs the full operation.

| Task | Development (`run=dev`) | Operation (`run=ops`) |
| --- | --- | --- |
| Visual similarity | `http://127.0.0.1:5173/tasks/visual-similarity?participant_id=H001&run=dev` | `http://127.0.0.1:5173/tasks/visual-similarity?participant_id=H001&run=ops` |
| Object matching | `http://127.0.0.1:5173/tasks/object-matching?participant_id=H001&run=dev` | `http://127.0.0.1:5173/tasks/object-matching?participant_id=H001&run=ops` |

The `participant_id` prefix selects the participant type: `H001` is saved as
`participantId: "001", participantType: "human"`, while `A001` is saved as
`participantId: "001", participantType: "agent"`. The `model` query parameter
is used for agent sessions and is saved as `"None"` for humans. Provider,
agent-name, and other optional identity parameters are not saved.

## Agent testing

Agent runs use the same URLs, with `participant_id`, `model`, and `run`. A real agent must
receive screenshots only; do not give it DOM, accessibility, task-data, or
source-code access.

The independent [agent harness](agent_harness/README.md) runs the deployed task
with Playwright and Google Agent Platform models. Its code and dependencies are
contained in `agent_harness/`; the website remains unchanged and continues to
save its own results and trajectories.

| Task | Development URL | Operation URL |
| --- | --- | --- |
| Visual similarity | `http://127.0.0.1:5173/tasks/visual-similarity?participant_id=A001&model=gpt-5.6-luna&run=dev` | `http://127.0.0.1:5173/tasks/visual-similarity?participant_id=A001&model=gpt-5.6-luna&run=ops` |
| Object matching | `http://127.0.0.1:5173/tasks/object-matching?participant_id=A001&model=gpt-5.6-luna&run=dev` | `http://127.0.0.1:5173/tasks/object-matching?participant_id=A001&model=gpt-5.6-luna&run=ops` |

Each saved session contains only this identity shape:

```json
{
  "sessionId": "dev_agent_001_20260816T160810Z_68593840",
  "participantId": "001",
  "participantType": "agent",
  "model": "gpt-5.6-luna",
  "runMode": "dev"
}
```

The website records testing cursor trajectories and saves them through the same
session payload for humans and agents. See [website cursor trajectories](docs/agent_cursor_tracing.md).

At completion, `run=dev` sessions automatically submit to the same-origin
`/api/experiments/sessions` endpoint. `run=ops` sessions use
`VITE_RESULTS_ENDPOINT` when configured; otherwise the completion screen keeps browser recovery data and
offers separate downloads for results and trajectories.

### Codex chat development prompts

Use these prompts in a fresh Codex chat for an exploratory, headed local run.
Codex chat must interact with the visible page only. The website saves its
testing trajectories through the same path used for human sessions.

#### Visual similarity

```text
Open this local experiment URL:

http://127.0.0.1:5173/tasks/visual-similarity?participant_id=A001&model=codex&run=dev

Complete the visible experiment using computer-use interaction only.

Rules:
- Use only what is visible in the browser. Do not inspect DOM, accessibility data, source code, files, network requests, task configuration, or hidden state.
- Click Start and Continue normally.
- For every trial, click the center cross first.
- For every testing trial, after clicking the cross, move the cursor toward your chosen response image through multiple small visible movements, then click the image.
- Do not jump directly from the center cross to a candidate with one direct click.
- Choose the image that appears most similar to the reference.
- Finish all 3 training trials and 10 testing trials.
- If “Save incomplete” appears, click `Download results`, then `Download trajectories`, and stop.
- If “Results saved successfully” appears, do not click a download button: the API already saved both files. Stop.
```

#### Object matching

```text
Open this local experiment URL:

http://127.0.0.1:5173/tasks/object-matching?participant_id=A001&model=codex&run=dev

Complete the visible experiment using computer-use interaction only.

Rules:
- Use only what is visible in the browser. Do not inspect DOM, accessibility data, source code, files, network requests, task configuration, or hidden state.
- Click Start and Continue normally.
- For every trial, click the center cross first.
- For every testing trial, after clicking the cross, move the cursor toward your selected option through multiple small visible movements, then click the option.
- Do not jump directly from the center cross to an option with one direct click. Move the cursor instead.
- Choose the candidate object that belongs with the central reference.
- Finish all 3 training trials and 10 testing trials.
- If “Save incomplete” appears, click `Download results`, then `Download trajectories`, and stop.
- If “Results saved successfully” appears, do not click a download button: the API already saved both files. Stop.
```

## Checks

```bash
npm test
npm run build
```

## Deployment

See [deployment](docs/deployment.md) for static-host rewrites, results API
configuration, access controls, and the screenshot-only agent boundary.
