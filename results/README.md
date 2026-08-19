# Results layout

Experiment results are organized by task:

- `response/<task>` contains complete trial JSON responses.
- `trajectory/<task>` contains pointer JSON trajectories.
- `figure/<task>` contains derived images for inspection and analysis.

Results remain in Git as research data and are never deployed in `dist`.

## Firestore export and offline comparison viewer

The export script reads the existing Firestore hierarchy with the Firebase
Admin SDK and writes a portable snapshot. It uses Application Default
Credentials, so authenticate with the Google Cloud CLI (or set
`GOOGLE_APPLICATION_CREDENTIALS`) before running it:

```bash
gcloud auth application-default login
node results/scripts/export_firestore.mjs \
  --project vibe-9d6e5 \
  --output results/firestore-export \
  --task visual_similarity
```

`--task` and `--session` are optional; repeat `--session` to export selected
sessions. The output folder contains `manifest.json`, `sessions.json`,
`responses.json`, and `trajectories.json`. It contains only serialized data,
not Firebase credentials or SDK objects. Trajectory records are associated
with their task by matching session and trial IDs, even when the stored
trajectory document itself has no `task` field.

Build the standalone viewer from that folder:

```bash
node results/scripts/build_results_viewer.mjs \
  --input results/firestore-export \
  --output results/firestore-export/viewer.html
open results/firestore-export/viewer.html       # macOS
```

All Firestore export artifacts and the generated viewer remain under
`results/firestore-export/`. The HTML is self-contained and works offline. It
has independent human and agent participant-ID selectors; the IDs do not need
to match. A missing side remains blank. It supports
task/run/model/participant/trial filters. Each side shows response
accuracy, reaction-time summaries, response coordinates, and the raw pointer
trajectory (start and end markers; no smoothing). No DOM, credentials, or
network access is used by the viewer.

Run the script tests with:

```bash
node --test results/scripts/export_firestore.node.mjs \
  results/scripts/build_results_viewer.node.mjs
```
