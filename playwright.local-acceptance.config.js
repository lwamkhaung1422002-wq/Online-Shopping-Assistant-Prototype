import {defineConfig} from '@playwright/test'
import retained from './playwright.retails.config.js'
export default defineConfig({
  ...retained,testDir:'./tests',
  metadata:{environment:'isolated demo-belle-online; no main Firebase data'},
  testMatch:['handover-browser/workflow.spec.js','retails-browser/public-recipe-handover.spec.js','retails-browser/legacy-sales.spec.js'],
  outputDir:'./test-results/local-acceptance',
  webServer:[retained.webServer,{command:'node scripts/dashboard-preview.mjs',url:'http://127.0.0.1:5175',reuseExistingServer:true}],
})
