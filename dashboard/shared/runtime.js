export function validateDashboardRuntime(env, apiUrl, projectId, shopId) {
  const mainLocal = env.VITE_MAIN_LOCAL === 'true'
  if (env.VITE_FIREBASE_DIRECT === 'true') {
    const demo = projectId?.startsWith('demo-')
    if (mainLocal || apiUrl || shopId !== 'belle-online' || projectId !== 'pos-shop-owner' && !(demo && env.DEV === true)) throw new Error('Direct Firebase requires the Belle project or isolated development demo and no local API.')
    return { mainLocal: false, useEmulator: demo, directMode: true }
  }
  const url = new URL(apiUrl)
  const local = ['localhost', '127.0.0.1'].includes(url.hostname)
  if (mainLocal) {
    if (env.DEV !== true || projectId !== 'pos-shop-owner' || shopId !== 'belle-online' || url.href !== 'http://127.0.0.1:5003/') throw new Error('Main dashboard requires its explicit local Firebase connection.')
  } else if (local && !projectId.startsWith('demo-')) throw new Error('Local API testing requires a demo Firebase project.')
  return { mainLocal, useEmulator: local && !mainLocal }
}
