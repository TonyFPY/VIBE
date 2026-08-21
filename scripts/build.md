cd /Users/tonyfeng/GitHub/vibe
npm run build

VITE_RESULTS_ENDPOINT=/api/experiments/sessions npm run build
npx --yes firebase-tools@latest deploy \
  --project vibe-9d6e5 \
  --only hosting

Local: 
npm run dev 


### Retrieve data
node results/scripts/export_firestore.mjs \
  --project vibe-9d6e5 \
  --output results/firestore-export        

node results/scripts/build_results_viewer.mjs \
  --input results/firestore-export \
  --output results/firestore-export/viewer.html

open results/firestore-export/viewer.html


