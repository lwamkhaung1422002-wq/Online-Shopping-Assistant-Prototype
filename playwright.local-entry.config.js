import {defineConfig} from '@playwright/test'
export default defineConfig({
 testDir:'./tests/retails-browser',testMatch:'local-entry.spec.js',outputDir:'./test-results/local-entry',workers:1,timeout:60000,
 use:{headless:true,launchOptions:{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'},trace:'retain-on-failure'},
 webServer:{command:'npm run dev --prefix "../BelleLocal POS app"',url:'http://127.0.0.1:5176',reuseExistingServer:false,
  // No preview flags: prove the primary npm dev entry and development file.
  env:{VITE_POS_V2:undefined,VITE_FIREBASE_DEMO_PROJECT:undefined,VITE_FIREBASE_API_URL:undefined,VITE_SHOP_ID:undefined}},
})
