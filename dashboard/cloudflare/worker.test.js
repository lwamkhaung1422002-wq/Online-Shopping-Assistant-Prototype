import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import worker from './worker.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
const env = { API_ORIGIN: 'https://api.example.com', API_PROXY_SECRET: 'isolated-test-secret-more-than-32-characters', ASSETS: { fetch: async () => new Response('SPA') }, PUBLIC_REQUEST_LIMITER: { limit: async () => ({ success: true }) } }
const headers = { 'CF-Connecting-IP': '198.51.100.9' }
const request = (path, options = {}) => new Request(`https://shop.example.com${path}`, { headers, ...options })

test('SPA deep links use the assets binding', async () => {
  assert.equal(await (await worker.fetch(request('/product/short'), env)).text(), 'SPA')
})
test('public checkout preserves body/query/IP but removes owner credentials and response cookies', async () => {
  let forwarded
  globalThis.fetch = async value => { forwarded = value; return new Response('{}', { status: 201, headers: { 'Set-Cookie': 'private=1', 'Cache-Control': 'public' } }) }
  const result = await worker.fetch(request('/api/public/shops/shop_1/checkout?x=1', { method: 'POST', headers: { ...headers, Authorization: 'Bearer private', Cookie: 'private=1', 'X-POS-Proxy-Token': 'forged', 'X-POS-Client-IP': 'forged' }, body: '{"items":[]}' }), env)
  assert.equal(forwarded.url, 'https://api.example.com/public/shops/shop_1/checkout?x=1')
  assert.equal(await forwarded.text(), '{"items":[]}')
  assert.equal(forwarded.headers.get('X-POS-Proxy-Token'), env.API_PROXY_SECRET)
  assert.equal(forwarded.headers.get('X-POS-Client-IP'), headers['CF-Connecting-IP'])
  assert.equal(forwarded.headers.get('Authorization'), null)
  assert.equal(forwarded.headers.get('Cookie'), null)
  assert.equal(result.headers.get('Set-Cookie'), null)
  assert.equal(result.headers.get('Cache-Control'), 'no-store')
  assert.equal(result.status, 201)
})
test('owner/unknown/encoded traversal routes and unsupported methods never reach upstream', async () => {
  globalThis.fetch = () => { throw new Error('Must not fetch') }
  for (const path of ['/api', '/api/auth/login', '/api/shops/shop/orders', '/api//evil.invalid', '/api/public/shops/shop/%2f..%2fauth', '/api/public/shops/shop/missing']) {
    assert.equal((await worker.fetch(request(path), env)).status, 404)
  }
  assert.equal((await worker.fetch(request('/api/public/shops/shop/catalog', { method: 'DELETE' }), env)).status, 404)
})
test('catalog, taxonomy, quote and private tracking route to the same fixed origin', async () => {
  globalThis.fetch = async value => { assert.equal(new URL(value.url).origin, env.API_ORIGIN); return Response.json({}) }
  for (const action of ['catalog', 'settings', 'taxonomy/categories', 'taxonomy/collections']) assert.equal((await worker.fetch(request(`/api/public/shops/shop/${action}`), env)).status, 200)
  for (const action of ['quote', 'track-order']) assert.equal((await worker.fetch(request(`/api/public/shops/shop/${action}`, { method: 'POST', body: '{}' }), env)).status, 200)
})
test('missing secrets/identity, invalid origins, redirects and network errors fail closed', async () => {
  const req = request('/api/public/shops/shop/catalog')
  assert.equal((await worker.fetch(req, { ...env, API_PROXY_SECRET: '' })).status, 503)
  for (const API_ORIGIN of ['http://api.example.com', 'https://user:secret@api.example.com', 'https://api.example.com/path', 'https://replace.invalid']) assert.equal((await worker.fetch(req, { ...env, API_ORIGIN })).status, 503)
  assert.equal((await worker.fetch(request('/api/public/shops/shop/catalog', { headers: {} }), env)).status, 403)
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: 'https://evil.invalid' } })
  assert.equal((await worker.fetch(req, env)).status, 502)
  globalThis.fetch = async () => { throw new Error('private detail') }
  const result = await worker.fetch(req, env)
  assert.equal(result.status, 502)
  assert.ok(!(await result.text()).includes('private detail'))
})

test('public POST bursts stop before upstream and use trusted IP plus route as the bucket', async () => {
  let key
  globalThis.fetch = () => { throw new Error('Must not forward a rejected request') }
  const req = request('/api/public/shops/shop/checkout', { method: 'POST', body: '{}' })
  const result = await worker.fetch(req, { ...env, PUBLIC_REQUEST_LIMITER: { limit: async input => { key = input.key; return { success: false } } } })
  assert.equal(result.status, 429)
  assert.equal(result.headers.get('Retry-After'), '60')
  assert.equal(result.headers.get('Cache-Control'), 'no-store')
  assert.equal(key, '/public/shops/shop/checkout:198.51.100.9')
  assert.equal((await worker.fetch(req, { ...env, PUBLIC_REQUEST_LIMITER: undefined })).status, 503)
  assert.equal((await worker.fetch(req, { ...env, PUBLIC_REQUEST_LIMITER: { limit: async () => { throw new Error('private backend failure') } } })).status, 503)
})
