import test from 'node:test'
import assert from 'node:assert/strict'
import { readMainHostedConfiguration } from '../../BelleLocal POS app/functions/src/main-hosted/config.js'
import { createMainHostedHandler } from '../../BelleLocal POS app/functions/src/main-hosted/api.js'
import { createMainSidecarFirestore } from '../../BelleLocal POS app/functions/src/main-local/firestore.js'

const owner = 'UXRbRF184gcohMkl4CdS0i0rdow2', shop = 'belle-online'
const env = { GCLOUD_PROJECT: 'pos-shop-owner', ONLINE_SHOP_ORIGINS: 'https://pos.example,https://shop.example,http://127.0.0.1:5178' }
function memory() {
  const records = new Map([[`users/${owner}/orders/original`, { total: 34500, paymentStatus: 'unpaid' }]])
  const writes = [], reads = []
  const snap = path => ({ id: path.split('/').at(-1), ref: doc(path), exists: records.has(path), data: () => structuredClone(records.get(path)), get: key => records.get(path)?.[key] })
  const doc = path => ({ path, firestore: db, id: path.split('/').at(-1), get: async () => { reads.push(path); return snap(path) },
    set: async data => { writes.push(path); records.set(path, structuredClone(data)) },
  })
  const db = { projectId: 'pos-shop-owner', doc, collection: path => ({ path, get: async () => ({ docs: [] }) }),
    runTransaction: async (action, options) => {
      const pending = [], tx = { get: ref => ref.get() }
      tx.set = (ref, data) => { assert.notEqual(options?.readOnly, true); pending.push(() => ref.set(data)); return tx }
      const result = await action(tx)
      for (const write of pending) await write()
      return result
    },
  }
  return { db, records, writes, reads }
}
const auth = { verifyIdToken: async token => ({ uid: token === 'owner' ? owner : 'another-owner' }) }
function response() {
  return { code: 200, headers: {}, set(name, value) { this.headers[name] = value; return this },
    status(code) { this.code = code; return this }, json(data) { this.data = data; return this }, send(data) { this.data = data; return this } }
}
async function request(handler, path, { origin = 'https://pos.example', token = 'owner', method = 'GET', body = {} } = {}) {
  const res = response()
  await handler({ path: `/${shop}/${path}`, method, body, query: {}, headers: { origin, authorization: `Bearer ${token}` }, socket: { remoteAddress: '127.0.0.1' } }, res)
  return res
}

test('hosted Main configuration fixes project/owner, exact CORS origins and explicit shared-stock activation', () => {
  assert.equal(readMainHostedConfiguration(env).writesEnabled, false)
  const active = readMainHostedConfiguration({ ...env, ONLINE_SHOP_MAIN_WRITES_ENABLED: 'true', ONLINE_SHOP_MAIN_CHECKOUT_ENABLED: 'true', ONLINE_SHOP_LEGACY_WRITERS_STOPPED: 'true' })
  assert.equal(active.checkoutEnabled, true)
  for (const change of [
    { GCLOUD_PROJECT: 'another-project' }, { FUNCTIONS_EMULATOR: 'true' }, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
    { ONLINE_SHOP_ID: 'another-shop' }, { ONLINE_SHOP_OWNER_UID: 'another-owner' }, { ONLINE_SHOP_ORIGINS: '' },
    { ONLINE_SHOP_ORIGINS: '*' }, { ONLINE_SHOP_ORIGINS: 'https://shop.example/path' },
    { ONLINE_SHOP_ORIGINS: 'https://shop.example?key=value' }, { ONLINE_SHOP_ORIGINS: 'https://user:pass@shop.example' },
    { ONLINE_SHOP_ORIGINS: 'http://shop.example' }, { ONLINE_SHOP_ORIGINS: 'http://127.0.0.1:5003' },
    { ONLINE_SHOP_MAIN_CHECKOUT_ENABLED: 'true' }, { ONLINE_SHOP_TRUSTED_PROXY_HOPS: 'bad' },
  ]) assert.throws(() => readMainHostedConfiguration({ ...env, ...change }))
})

test('hosted handler reuses scoped settings, preserves auth/CORS and rejects default mutations without writing original data', async () => {
  const raw = memory(), before = structuredClone([...raw.records])
  const handler = createMainHostedHandler({ rawDb: raw.db, auth, bucket: {}, env })
  const settings = await request(handler, 'admin/pos/settings')
  assert.equal(settings.code, 200); assert.equal(settings.data.settings.currencyCode, 'MMK')
  assert.equal(settings.headers['Access-Control-Allow-Origin'], 'https://pos.example')
  const denied = await request(handler, 'admin/pos/settings', { token: 'other' })
  assert.equal(denied.code, 403); assert.equal(denied.headers['Access-Control-Allow-Origin'], 'https://pos.example')
  assert.equal((await request(handler, 'admin/pos/settings', { method: 'PATCH' })).code, 405)
  const readCount = raw.reads.length
  assert.equal((await request(handler, 'admin/pos/settings', { origin: 'https://unknown.example' })).code, 403)
  assert.equal(raw.reads.length, readCount)
  assert.deepEqual(raw.writes, []); assert.deepEqual([...raw.records], before)
  const preflight = await request(handler, 'catalog', { origin: 'https://shop.example', method: 'OPTIONS' })
  assert.equal(preflight.code, 204); assert.equal(preflight.headers['Access-Control-Allow-Origin'], 'https://shop.example')
})

test('hosted checkout never uses the local verification bypass, even for a loopback socket; guard writes only scoped budgets', async () => {
  const raw = memory(), original = structuredClone(raw.records.get(`users/${owner}/orders/original`))
  let verifications = 0
  const handler = createMainHostedHandler({ rawDb: raw.db, auth, bucket: {},
    env: { ...env, ONLINE_SHOP_MAIN_WRITES_ENABLED: 'true', ONLINE_SHOP_MAIN_CHECKOUT_ENABLED: 'true', ONLINE_SHOP_LEGACY_WRITERS_STOPPED: 'true', TURNSTILE_HOSTNAMES: 'shop.example' },
    turnstileSecret: 'fixture-only-secret', rateLimitKey: 'fixture-only-rate-key-at-least-32-characters',
    fetchImpl: async () => { verifications++; return { ok: true, json: async () => ({ success: false }) } },
  })
  const rejected = await request(handler, 'checkout', { origin: 'https://shop.example', method: 'POST', body: { challenge: 'fixture-token' } })
  assert.equal(rejected.code, 403); assert.equal(verifications, 1)
  assert.equal(raw.writes.length, 2)
  assert.ok(raw.writes.every(path => path.startsWith(`onlineShopV2/${shop}/request_limits/`)))
  assert.deepEqual(raw.records.get(`users/${owner}/orders/original`), original)
  assert.ok(![...raw.records.keys()].some(path => path.includes('/pos_orders/') || path.includes('/orders/') && !path.startsWith('users/')))
})

test('long hashed rate-budget identifiers are admitted only in the configured new request_limits table',()=>{
  const raw=memory(), db=createMainSidecarFirestore(raw.db)
  const key=`track-order-${'a'.repeat(64)}-29865269`
  assert.doesNotThrow(()=>db.doc(`onlineShopV2/${shop}/request_limits/${key}`))
  for(const path of [`users/${owner}/orders/${key}`,`onlineShopV2/${shop}/pos_orders/${key}`,`onlineShopV2/other/request_limits/${key}`,`onlineShopV2/${shop}/request_limits/${'a'.repeat(129)}`])assert.throws(()=>db.doc(path),{status:403})
  assert.deepEqual(raw.writes,[])
})
