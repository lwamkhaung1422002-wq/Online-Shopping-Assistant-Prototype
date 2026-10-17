import { access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'

export async function frontendRunning(url, identity, fetcher = fetch) {
  let response
  try { response = await fetcher(url, { method:'HEAD',signal:AbortSignal.timeout(2000) }) }
  catch { return false }
  if (response.headers.get('x-belle-frontend') !== identity) throw Error(`Port ${new URL(url).port} belongs to a different service. Stop that service or use another configured port.`)
  if (!response.ok) throw Error(`The ${identity} server is running but not ready (HTTP ${response.status}).`)
  return true
}

export async function openChrome(url) {
  const target=new URL(url)
  if(target.hostname!=='127.0.0.1'||!['5178','5179'].includes(target.port))throw Error('Unexpected development URL.')
  const candidates=[
    join(process.env.PROGRAMFILES||'C:/Program Files','Google','Chrome','Application','chrome.exe'),
    join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Google','Chrome','Application','chrome.exe'),
    process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Google','Chrome','Application','chrome.exe'),
  ].filter(Boolean)
  for(const executable of candidates) {
    try {await access(executable)} catch {continue}
    const browser=spawn(executable,[url],{detached:true,stdio:'ignore'})
    await once(browser,'spawn');browser.unref();return
  }
  throw Error(`Chrome was not found. Open ${url} manually.`)
}
