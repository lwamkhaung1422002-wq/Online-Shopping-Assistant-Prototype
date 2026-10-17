import { getApp, getApps, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { validateDashboardRuntime } from './runtime.js'
import { createQuotaBackoff } from './request-quota.js'
export function readFirebaseConfiguration(env) {
  const apiUrl = env.VITE_FIREBASE_API_URL?.trim().replace(/\/$/, '')
  const shopId = env.VITE_SHOP_ID?.trim() || 'belle-online'
  const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim()
  const apiKey = env.VITE_FIREBASE_API_KEY?.trim()
  const appId = env.VITE_FIREBASE_APP_ID?.trim()
  const directMode = env.VITE_FIREBASE_DIRECT === 'true'
  if ((!apiUrl && !directMode) || !projectId || !apiKey || !appId) return { auth: null, apiUrl: '', shopId, configured: false }
  if (apiUrl) {
    const url = new URL(apiUrl)
    const local = ['localhost', '127.0.0.1'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || !/^[a-zA-Z0-9_-]{1,80}$/.test(shopId)) throw new Error('Invalid Firebase API URL or shop ID.')
  }
  const runtime = validateDashboardRuntime(env, apiUrl || '', projectId, shopId)
  const app = getApps().some((a) => a.name === 'online-shop') ? getApp('online-shop') : initializeApp({ apiKey, appId, projectId, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com` }, 'online-shop')
  const auth = getAuth(app)
  if (runtime.useEmulator && !auth.emulatorConfig) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  return { auth, apiUrl: apiUrl || '', shopId, configured: true, mainLocal: runtime.mainLocal, directMode }
}
export function createApi(configuration) {
  const quota = configuration.quota || createQuotaBackoff()
  return async function api(path, body, { admin = false, method = body === undefined ? 'GET' : 'POST' } = {}) {
    if (!configuration.configured) throw new Error('The shop is not connected yet. Please contact the shop.')
    quota.check()
    const headers = { 'Content-Type': 'application/json' }
    if (admin) {
      const user = configuration.auth.currentUser
      if (!user) throw new Error('Please sign in again.')
      headers.Authorization = `Bearer ${await user.getIdToken()}`
    }
    let response
    try { response = await fetch(`${configuration.apiUrl}/${encodeURIComponent(configuration.shopId)}/${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) }
    catch { throw new Error('Cannot reach the shop API. Please retry after the service is restored.') }
    const data = await response.json()
    if (!response.ok) {
      const error = new Error(data.error || 'Unable to reach the shop. Retry using the same request.')
      error.status = response.status
      error.code = data.code
      error.definitive = data.order_rejected === true
      quota.note(response, error)
      throw error
    }
    return data
  }
}
