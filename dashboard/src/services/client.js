// Connected storefronts share the POS HTTP API and PostgreSQL contracts.
// Missing configuration keeps the existing read-only prototype preview.
export const shopId = (import.meta.env.VITE_SHOP_ID || '').trim()
const base = (import.meta.env.VITE_PUBLIC_API_BASE_URL || '/api').replace(/\/$/, '')
export const configured = Boolean(shopId)
export async function api(path, body, { method = body === undefined ? 'GET' : 'POST' } = {}) {
  if (!configured) throw new Error('The online shop is not connected yet.')
  const response = await fetch(`${base}/public/shops/${encodeURIComponent(shopId)}/${path}`, {
    method, headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch(() => { throw new Error('Unable to reach the shop. Keep this request and retry when connected.') })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(data?.message || 'Unable to complete this request.')
    error.code = data?.code; error.status = response.status
    // Known rollbacks allow correction; network/5xx failures retain the key.
    error.definitive = [400, 404, 409, 422].includes(response.status)
    throw error
  }
  return data
}
