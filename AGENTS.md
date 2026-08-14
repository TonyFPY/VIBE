# AGENTS.md

## Goal

Extend the existing repository into a shared **human + agent visual behavior platform**.

Build on the existing:

* data and stimulus assets;
* task definitions;
* experiment package;
* trial generation;
* data collection;
* analysis code.

Do not create a parallel experiment stack unless the current architecture makes reuse impossible.

Task-specific specifications:

* [`docs/visual_similarity.md`](docs/visual_similarity.md)
* [`docs/object_matching.md`](docs/object_matching.md)

## Overall Pipeline

```text
Existing data / tasks
        ↓
Shared experimental website
        ↓
Same rendered trial for humans and agents
       / \
      /   \
 Human     Agent browser
 browser   (Playwright)
   │           │
keyboard/   screenshot
pointer        ↓
   │       AWS Bedrock VLM
   │           ↓
   │      keyboard/pointer
   └───────────┘
        ↓
Existing data collection
        ↓
Human-agent analysis
```

## Core Requirement

Humans and agents must use the **same experiment implementation** wherever possible:

```text
same stimuli
same trial generation
same browser rendering
same response mapping
same data schema
```

Only the observer differs.

## Human Mode

Human participants:

1. open the experiment URL;
2. read instructions;
3. complete trials visually;
4. respond using keyboard/pointer;
5. responses are recorded through the existing collection pipeline.

Use:

```text
observer_type = human
```

## Agent Mode

Agent runs:

1. launch the same experiment URL in Chromium;
2. capture the rendered screen;
3. send screenshot + public instruction to an AWS Bedrock multimodal model;
4. receive a constrained action;
5. execute the action through Playwright;
6. repeat until the experiment is complete.

Use:

```text
observer_type = agent
```

The agent must interact through **visual input and keyboard/pointer output only**.

## Agent Information Boundary

The default agent condition must NOT expose:

* DOM or HTML;
* accessibility tree;
* Playwright `page` object;
* JavaScript execution;
* source code;
* filesystem;
* task configuration;
* stimulus metadata;
* correct response;
* answer keys;
* hidden experiment state;
* OCR/helper tools not explicitly part of the condition.

The environment/controller owns the browser. The model receives screenshots only.

Conceptually:

```text
Private experiment state
        ↓
browser renderer
        ↓
screen pixels
---------------------- boundary
        ↓
Bedrock model
        ↓
keyboard / pointer action
```

## Browser Controller

Prefer a thin Playwright controller.

Responsibilities:

```text
open URL
capture screenshot
send observation to agent
validate returned action
execute keyboard/pointer action
log interaction metadata
detect experiment completion
```

Do not put task-solving logic in the controller.

## Agent Actions

Use structured, restricted actions.

Examples:

```text
CLICK(x, y)
MOVE(x, y)
```

Each task should declare its allowed action set.

Do not allow arbitrary code execution.

Invalid actions must be logged, not silently corrected.

## Experimental Website

The browser-facing experiment should be a thin layer over the existing experiment package.

It should:

* render existing trials;
* expose only participant-visible information;
* capture keyboard/pointer responses;
* use existing trial/session IDs;
* send responses into the existing data-collection pathway.

Do not duplicate task logic in the frontend.

## Multi-Task Website Structure

Use one shared Vite/TypeScript website and shared experiment stack for every
task. Keep common browser, session, persistence, and agent-boundary code in:

```text
tasks/shared/
  app/          # routing, bootstrap, global styles
  experiment/   # sessions, public/private state, persistence
  agent/        # screenshot-only controller adapters
  components/   # instructions, progress, saving UI
```

Each task owns only its data adapter, trial rules, renderer, and tests:

```text
tasks/<task-name>/
  task.ts
  renderer.ts
  tests/
```

Route each task through the shared app, for example
`/tasks/visual-similarity`. Tasks must reuse `tasks/shared` and must not create
parallel browser, persistence, session, or agent-control stacks.

## Task Implementations

Read the relevant task specification before modifying task code:

### Visual Similarity

See:

[`docs/visual_similarity.md`](docs/visual_similarity.md)

### Object Matching

See:

[`docs/object_matching.md`](docs/object_matching.md)

Follow those files for task-specific stimulus layout, conditions, responses, and dependent variables.

## Data Logging

Reuse the existing behavioral data schema and minimally extend it for agent metadata.

Record where available:

```text
observer_type
participant_id / agent_session_id
trial_id
stimulus_id
condition
response
correct

agent_model
agent_provider
observation_count
action_count
raw_model_output
parsed_action
action_valid

screenshot_id
viewport size

model_request_started_at
model_response_completed_at
action_registered_at
```

Do not treat raw agent latency as directly equivalent to human reaction time.

Agent completion latency may be analyzed separately as a whole-system measure.

## Repeated Agent Runs

Use independent:

```text
agent_session
```

or:

```text
agent_run
```

terminology, not `participant`.

Each run should support:

* fresh model context;
* fixed/logged model configuration;
* randomized trial order;
* logged random seed;
* no cross-session memory.

## No-Cheating Tests

Add automated tests ensuring hidden information never reaches the model.

Use canary values in tests, e.g.:

```text
SECRET_ANSWER_CANARY
```

Assert that they never appear in:

* agent observation objects;
* prompts;
* serialized Bedrock requests;
* URLs or filenames exposed to the model.

Also test that agent code cannot access the Playwright page/DOM interface.

## Implementation Order

1. Inspect the existing repository.
2. Identify reusable task, experiment, rendering, and collection abstractions.
3. Run existing tests.
4. Implement the shared browser experiment.
5. Connect one existing task end-to-end.
6. Add Playwright screenshot/action controller.
7. Add deterministic mock agents.
8. Add one AWS Bedrock visual-agent adapter.
9. Add no-cheating enforcement/tests.
10. Integrate agent records with existing analysis.
11. Verify existing human experiments still work.

## Coding Constraints

Do:

* extend existing abstractions;
* make minimal targeted changes;
* preserve human compatibility;
* keep public and private trial state separate;
* write tests for information boundaries;
* keep agent/provider logic behind an adapter.

Do not:

* rewrite the repository unnecessarily;
* maintain separate human and agent task implementations;
* give the visual agent privileged page information;
* duplicate data collection;
* require paid Bedrock calls in CI;
* silently repair invalid model actions;
* perform unrelated refactors.

## Definition of Done

The pipeline is working when:

```text
same experiment URL
    ↓
human can complete task
AND
agent can complete task through screenshots + keyboard/pointer
    ↓
both responses enter the existing data pipeline
    ↓
human and agent trials can be aligned by task/stimulus IDs
```

At least one task from the linked documentation must run end-to-end under both observer modes.
