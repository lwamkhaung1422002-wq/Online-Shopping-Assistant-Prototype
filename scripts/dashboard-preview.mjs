import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import process from 'node:process'

// Explicit isolated preview. Never reuse a production Firebase configuration.
const demo={VITE_FIREBASE_API_URL:'http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi',VITE_FIREBASE_PROJECT_ID:'demo-belle-online',VITE_FIREBASE_API_KEY:'demo-key',VITE_FIREBASE_APP_ID:'demo-app',VITE_FIREBASE_DEMO_PROJECT:'demo-belle-online',VITE_SHOP_ID:'belle-online',VITE_TURNSTILE_SITE_KEY:''}
const child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/vite/bin/vite.js',import.meta.url)),'--host','127.0.0.1','--port','5175','--strictPort','--no-open'],{cwd:fileURLToPath(new URL('../dashboard/',import.meta.url)),env:{...process.env,...demo},stdio:'inherit'})
child.on('error',(error)=>{console.error(error.message);process.exitCode=1})
child.on('exit',(code)=>{process.exitCode=code??1})
process.on('SIGINT',()=>child.kill('SIGINT'))
process.on('SIGTERM',()=>child.kill('SIGTERM'))
