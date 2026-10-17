import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/firebase-browser', testMatch: 'verification.spec.js', outputDir: './test-results/verification', workers: 1, timeout: 60000,
  use: { headless: true, launchOptions: { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }, trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev --prefix dashboard -- --host 127.0.0.1 --port 5175 --strictPort --no-open', url: 'http://127.0.0.1:5175', reuseExistingServer: false,
    env: { VITE_FIREBASE_API_URL: 'http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi',
      VITE_FIREBASE_PROJECT_ID: 'demo-belle-online', VITE_FIREBASE_API_KEY: 'demo-key', VITE_FIREBASE_APP_ID: 'demo-app', VITE_SHOP_ID: 'belle-online',
      // Published test key; the widget is a deterministic browser double below.
      VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA' } },
})
