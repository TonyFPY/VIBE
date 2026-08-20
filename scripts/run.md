## dev 
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task visual-similarity \
  --model google/gemini-3.5-flash \
  --runMode dev \
  --pid 1 

## ops
### Visual Similarity Task
#### 1 9 17 25 33
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task visual-similarity \
  --model google/gemini-3.5-flash-lite \
  --runMode ops \
  --pid 33 

#### 2 10 18 26 34
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task visual-similarity \
  --model google/gemini-3-flash-preview \
  --runMode ops \
  --pid 34 

#### 3 11 19 27 35
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task visual-similarity \
  --model google/gemini-3.5-flash \
  --runMode ops \
  --pid 35 

#### 4 12 20 28 36
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task visual-similarity \
  --model google/gemini-3.7-flash \
  --runMode ops \
  --pid 36 

### Object Matching Task

#### 5 13 21 29 37
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task object-matching \
  --model google/gemini-3.5-flash-lite \
  --runMode ops \
  --pid 37 

#### 6 14 22 30 38
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task object-matching \
  --model google/gemini-3-flash-preview \
  --runMode ops \
  --pid 38 

#### 7 15 23 31 39
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task object-matching \
  --model google/gemini-3.5-flash \
  --runMode ops \
  --pid 39 

#### 8 16 24 32 40
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task object-matching \
  --model google/gemini-3.7-flash \
  --runMode ops \
  --pid 40 


node results/scripts/export_firestore.mjs \
  --project vibe-9d6e5 \
  --output results/firestore-export        

node results/scripts/build_results_viewer.mjs \
  --input results/firestore-export \
  --output results/firestore-export/viewer.html

open results/firestore-export/viewer.html