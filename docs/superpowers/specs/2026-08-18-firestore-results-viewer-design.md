# Firestore Results Export and Comparison Viewer

## Goal

Provide a repeatable, credential-safe workflow that exports experiment data
from Firestore into a chosen local folder and generates an offline interactive
HTML viewer for human-versus-agent comparison.

## Data source and security

The exporter uses Firebase Admin credentials through Application Default
Credentials or an explicitly configured service account. It reads the existing
Firestore hierarchy:

```text
experimentSessions/{sessionId}
  results/{resultId}
  trajectories/{trajectoryId}
```

The browser viewer receives only an exported snapshot. It never contains
Firestore credentials, performs network reads, or depends on Firestore client
rules.

## Export workflow

Create `results/scripts/export_firestore.mjs` with explicit CLI options:

```text
--project <project-id>
--database <database-id>       default: (default)
--output <folder>              required
--session <session-id>         repeatable optional filter
--task <visual_similarity|object_matching> optional filter
```

The script writes deterministic JSON files in the requested folder:

```text
manifest.json
sessions.json
responses.json
trajectories.json
```

The manifest records project/database, export time, counts, and the exporter
version. Firestore timestamps and document references are converted to JSON
safe values. Export failures stop with a non-zero exit code and do not produce
a misleading success manifest.

## Viewer workflow

Create `results/scripts/build_results_viewer.mjs` with `--input` and
`--output` options. It validates the snapshot shape, embeds the data into one
self-contained HTML document, and writes no credentials or external data
requests.

The viewer provides:

- task, run mode, participant type, model, session, and trial filters;
- paired human/agent comparison by task and trial ID;
- correctness and reaction-time comparisons;
- response-coordinate comparison;
- trajectory overlays with start/end markers and no smoothing;
- an explicit unpaired/missing-data state rather than silently dropping rows;
- a session/trial detail table with the raw selected records.

The comparison uses shared scales and labels human and agent series directly;
it does not infer correctness or invent missing values.

## Example

```bash
node results/scripts/export_firestore.mjs \
  --project vibe-9d6e5 \
  --database "(default)" \
  --output /tmp/vibe-firestore-export

node results/scripts/build_results_viewer.mjs \
  --input /tmp/vibe-firestore-export \
  --output results/visualization/experiment-results.html
```

## Tests and compatibility

Tests use local snapshot fixtures and never contact Firestore. They cover
document normalization, filtering, malformed snapshot rejection, HTML data
embedding, human/agent pairing, and trajectory rendering data. Existing local
response/trajectory files and the Python plotting script remain unchanged.
