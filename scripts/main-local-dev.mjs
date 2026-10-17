import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, open, readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolveDevCredential } from './main-dev-credential.mjs'
import { frontendRunning, openChrome } from './main-dev-browser.mjs'

const primary=fileURLToPath(new URL('../../BelleLocal POS app/',import.meta.url))
async function apiReady() {
  try {
    const response=await fetch('http://127.0.0.1:5003/belle-online/settings',{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:5178'},signal:AbortSignal.timeout(1500)})
    if(response.headers.get('x-belle-local-api')!=='main')throw Error('Port 5003 is occupied by a different service.')
    return response.status===204
  } catch(error) {if(error.message.includes('different service'))throw error;return false}
}
async function ensureApi() {
  if(!await apiReady()) {
    const credential = resolveDevCredential(process.env)
    await mkdir(new URL('../.local/service-logs/',import.meta.url),{recursive:true})
    const errorLog = new URL('../.local/service-logs/main-api.err.log',import.meta.url)
    const output=await open(new URL('../.local/service-logs/main-api.out.log',import.meta.url),'a'),errors=await open(new URL('../.local/service-logs/main-api.err.log',import.meta.url),'a')
    const errorOffset=(await stat(errorLog)).size
    const api=spawn(process.execPath,['functions/src/main-local/server.mjs','--run-live','--allow-sidecar-writes','--legacy-writers-stopped','--local-media','--allow-checkout'],{cwd:primary,env:{...process.env,GOOGLE_APPLICATION_CREDENTIALS:credential},detached:true,windowsHide:true,stdio:['ignore',output.fd,errors.fd]})
    let exited=false
    api.once('exit',()=>{exited=true})
    try {await once(api,'spawn');api.unref()} finally {await output.close();await errors.close()}
    const deadline=Date.now()+30_000
    while(!await apiReady()) {
      if(exited) {
        const reason=(await readFile(errorLog)).subarray(errorOffset).toString('utf8').trim()
        throw Error(reason || 'Main API exited before listening. Check OnlineShoppingDashboard/.local/service-logs/main-api.err.log.')
      }
      if(Date.now()>deadline)throw Error('Main API is still starting. Check OnlineShoppingDashboard/.local/service-logs/main-api.err.log before starting another instance.')
      await new Promise(resolve=>setTimeout(resolve,300))
    }
    console.log('Main Firebase API started on 127.0.0.1:5003. It remains available for both local apps.')
  } else console.log('Using the running Main Firebase API on 127.0.0.1:5003.')
}
export async function runDevServices(startFrontend, startApi, onApiError) {
  // API authentication/availability must not gate the Vite development server.
  const frontend = startFrontend()
  await Promise.resolve().then(startApi).catch(onApiError)
  return frontend
}
async function main() {
  const mode=process.argv[2]
  if(!['--pos','--dashboard','--ensure-api-only'].includes(mode)||process.argv.length!==3)throw Error('Choose the Main POS or dashboard launcher.')
  if(mode==='--ensure-api-only') { await ensureApi(); return }
  const pos=mode==='--pos',directory=pos?primary:fileURLToPath(new URL('../dashboard/',import.meta.url))
  const url=`http://127.0.0.1:${pos?'5178':'5179'}/`,identity=pos?'pos':'dashboard'
  if(await frontendRunning(url,identity)) {
    console.log(`\n  ${pos?'Belle POS':'Belle Dashboard'} is already running.\n  ➜  Local:   ${url}\n`)
    await openChrome(url)
    await ensureApi().catch(error=>console.error(`[Main API] ${error.message}`))
    return
  }
  await runDevServices(() => {
    const vite=spawn(process.execPath,[`${directory}node_modules/vite/bin/vite.js`,'--mode','main-local','--host','127.0.0.1','--port',pos?'5178':'5179','--strictPort','--no-open'],{cwd:directory,stdio:'inherit',windowsHide:true})
    vite.on('error',error=>{console.error(error.message);process.exitCode=1})
    vite.on('exit',code=>{process.exitCode=code||0})
    void (async()=>{
      const deadline=Date.now()+30_000
      while(vite.exitCode===null) {
        if(await frontendRunning(url,identity)) {console.log(`\n  ➜  Local:   ${url}\n  Opening Chrome…\n`);await openChrome(url);return}
        if(Date.now()>deadline)throw Error(`Frontend is still starting. Open ${url} when ready.`)
        await new Promise(resolve=>setTimeout(resolve,300))
      }
    })().catch(error=>console.error(error.message))
    return vite
  },ensureApi,error=>console.error(`[Main API] ${error.message}\nThe frontend stays available; data actions need the API.`))
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(error=>{console.error(error.message);process.exitCode=1})
