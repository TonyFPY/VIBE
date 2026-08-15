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

Open one of these URLs in a normal browser. Development mode is exactly three
training trials followed by ten testing trials. Omit `mode=development` for a
full session.

| Task | Development run | Full run |
| --- | --- | --- |
| Visual similarity | `http://127.0.0.1:5173/tasks/visual-similarity?observer=human&participant_id=dev-human&mode=development` | `http://127.0.0.1:5173/tasks/visual-similarity?observer=human&participant_id=P001` |
| Object matching | `http://127.0.0.1:5173/tasks/object-matching?observer=human&participant_id=dev-human&mode=development` | `http://127.0.0.1:5173/tasks/object-matching?observer=human&participant_id=P001` |

## Agent testing

Agent runs use the same URLs, with agent identity parameters. A real agent must
receive screenshots only; do not give it DOM, accessibility, task-data, or
source-code access.

| Task | Development URL | Full-run URL |
| --- | --- | --- |
| Visual similarity | `http://127.0.0.1:5173/tasks/visual-similarity?observer=agent&provider=openai&model=gpt-5&agent_name=codex&mode=development` | `http://127.0.0.1:5173/tasks/visual-similarity?observer=agent&provider=openai&model=gpt-5&agent_name=codex` |
| Object matching | `http://127.0.0.1:5173/tasks/object-matching?observer=agent&provider=openai&model=gpt-5&agent_name=codex&mode=development` | `http://127.0.0.1:5173/tasks/object-matching?observer=agent&provider=openai&model=gpt-5&agent_name=codex` |

The website records testing cursor trajectories and saves them through the same
session payload for humans and agents. See [website cursor trajectories](docs/agent_cursor_tracing.md).

### Codex chat development prompts

Use these prompts in a fresh Codex chat for an exploratory, headed local run.
Codex chat must interact with the visible page only. The website saves its
testing trajectories through the same path used for human sessions.

#### Visual similarity

```text
Open this local experiment URL:

http://127.0.0.1:5173/tasks/visual-similarity?observer=agent&provider=openai&model=codex&agent_name=codex-chat&mode=development

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

http://127.0.0.1:5173/tasks/object-matching?observer=agent&provider=openai&model=codex&agent_name=codex-chat&mode=development

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
