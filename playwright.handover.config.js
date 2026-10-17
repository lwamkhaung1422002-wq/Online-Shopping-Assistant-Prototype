import {defineConfig} from '@playwright/test'
const env={VITE_FIREBASE_API_URL:'http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi',VITE_FIREBASE_PROJECT_ID:'demo-belle-online',VITE_FIREBASE_API_KEY:'demo-key',VITE_FIREBASE_APP_ID:'demo-app',VITE_FIREBASE_DEMO_PROJECT:'demo-belle-online',VITE_SHOP_ID:'belle-online',VITE_TURNSTILE_SITE_KEY:''}
export default defineConfig({testDir:'./tests/handover-browser',outputDir:'./test-results/handover',workers:1,timeout:120000,use:{headless:true,launchOptions:{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'},trace:'retain-on-failure'},webServer:[
  {command:'npm run dev --prefix dashboard -- --host 127.0.0.1 --port 5175 --strictPort --no-open',url:'http://127.0.0.1:5175',reuseExistingServer:false,env},
  {command:'npm run dev:pos-preview --prefix "../BelleLocal POS app" -- --no-open',url:'http://127.0.0.1:5176',reuseExistingServer:true,env},
]})
