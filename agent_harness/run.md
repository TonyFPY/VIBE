./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task visual-similarity \
  --model google/gemini-3.5-flash \
  --runMode dev \
  --pid 9 

./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task visual-similarity \
  --model google/gemini-3.5-flash-lite \
  --runMode dev \
  --pid 10 

./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task visual-similarity \
  --model google/gemini-3-flash-preview \
  --runMode dev \
  --pid 11 

./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task object-matching \
  --model google/gemini-3.5-flash \
  --runMode dev \
  --pid 12 

./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task object-matching \
  --model google/gemini-3.5-flash-lite \
  --runMode dev \
  --pid 13 

./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task object-matching \
  --model google/gemini-3-flash-preview \
  --runMode dev \
  --pid 14 

node results/scripts/export_firestore.mjs \
  --project vibe-9d6e5 \
  --output results/firestore-export        

node results/scripts/build_results_viewer.mjs \
  --input results/firestore-export \
  --output results/firestore-export/viewer.html

open results/firestore-export/viewer.html