import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir:'./tests/retails-browser',outputDir:'./test-results/retails',workers:1,timeout:60000,
  use:{headless:true,launchOptions:{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'},trace:'retain-on-failure'},
  webServer:{command:'npm run dev --prefix "../BelleLocal POS app" -- --host 127.0.0.1 --port 5176 --strictPort --no-open',url:'http://127.0.0.1:5176',reuseExistingServer:true,
    env:{VITE_POS_V2:'true',VITE_FIREBASE_API_URL:'http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi',VITE_FIREBASE_DEMO_PROJECT:'demo-belle-online',VITE_SHOP_ID:'belle-online'}},
})
