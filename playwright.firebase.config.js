import { defineConfig } from '@playwright/test'
const env = {
  VITE_FIREBASE_API_URL: 'http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi',
  VITE_FIREBASE_PROJECT_ID:'demo-belle-online', VITE_FIREBASE_API_KEY:'demo-key', VITE_FIREBASE_APP_ID:'demo-app',
  VITE_FIREBASE_DEMO_PROJECT:'demo-belle-online', VITE_SHOP_ID:'belle-online', VITE_TURNSTILE_SITE_KEY:'',
}
export default defineConfig({
  testDir:'./tests/firebase-browser', testIgnore:'verification.spec.js', outputDir:'./test-results/workflow', workers:1, timeout:60000,
  use:{ headless:true, launchOptions:{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'},trace:'retain-on-failure' },
  webServer:[
    {command:'npm run dev --prefix dashboard -- --host 127.0.0.1 --port 5173 --strictPort --no-open',url:'http://127.0.0.1:5173',env,reuseExistingServer:false},
    {command:'npm run dev --prefix "../BelleLocal POS app" -- --host 127.0.0.1 --port 5174 --strictPort --no-open',url:'http://127.0.0.1:5174',env,reuseExistingServer:false},
  ],
})
