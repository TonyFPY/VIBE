cd /Users/tonyfeng/GitHub/vibe
npm run build
VITE_RESULTS_ENDPOINT=/api/experiments/sessions npm run build
npx --yes firebase-tools@latest deploy \
  --project vibe-9d6e5 \
  --only hosting

Local: 
npm run dev 