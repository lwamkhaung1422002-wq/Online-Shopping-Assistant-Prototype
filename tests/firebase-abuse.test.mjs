import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicGuard, sourceAddress } from '../../BelleLocal POS app/functions/src/online-shop/abuse.js'
import { createShopApi } from '../../BelleLocal POS app/functions/src/online-shop/api.js'

// Serial transactional double: real multi-instance contention is exercised in the
// emulator suite. Siteverify responses here are doubles, never real widget proof.
function database() {
  const records = new Map(); let queue = Promise.resolve()
  return { records, doc: (path) => ({ path }), runTransaction(callback) {
    const result = queue.then(async () => {
      const writes = []
      await callback({ get: async (ref) => ({ data: () => records.get(ref.path) }),
        set: (ref, value) => writes.push(() => records.set(ref.path, value)) })
      writes.forEach((commit) => commit())
    })
    queue = result.catch(() => {}); return result
  } }
}
const req = () => ({ headers: { origin: 'https://shop.example' }, socket: { remoteAddress: '192.0.2.8' } })
const key = 'test-key-at-least-32-characters-long'
const good = { success: true, action: 'checkout', hostname: 'shop.example' }
function fixture(options = {}) {
  const db = database(); const calls = []
  const guard = createPublicGuard({ db, projectId: 'production-project', secret: 'test-secret', rateLimitKey: key,
    expectedHostnames: ['shop.example'], fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => good } }, ...options })
  return { db, calls, guard }
}

test('Siteverify requires exact success, action and hostname and posts only to Cloudflare', async () => {
  const { guard, calls, db } = fixture()
  await guard('belle-online', 'checkout', req(), { challenge: 'fresh-token' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
  assert.equal(calls[0].init.body.get('response'), 'fresh-token')
  assert.equal(calls[0].init.body.get('secret'), 'test-secret')
  assert.equal(calls[0].init.body.has('remoteip'), false)
  assert.ok(calls[0].init.signal instanceof AbortSignal)
  const stored = JSON.stringify([...db.records])
  for (const privateValue of ['192.0.2.8', 'fresh-token', 'test-secret']) assert.equal(stored.includes(privateValue), false)
  for (const result of [{ ...good, success: 'true' }, { ...good, action: 'login' }, { ...good, hostname: 'evil.example' }, { ...good, hostname: 'admin.example' }]) {
    const { guard } = fixture({ expectedHostnames: ['shop.example', 'admin.example'], fetchImpl: async () => ({ ok: true, json: async () => result }) })
    await assert.rejects(guard('belle-online', 'checkout', req(), { challenge: 'token' }), { status: 403 })
  }
})

test('missing/oversized/replayed tokens and provider failures fail closed before order writes', async () => {
  const { guard, calls } = fixture()
  for (const challenge of ['', undefined, 'x'.repeat(2049)]) await assert.rejects(guard('belle-online', 'checkout', req(), { challenge }), { status: 403 })
  assert.equal(calls.length, 0)
  let used = false
  const replayGuard = fixture({ fetchImpl: async () => ({ ok: true, json: async () => { const result = used ? { success: false, 'error-codes': ['timeout-or-duplicate'] } : good; used = true; return result } }) }).guard
  await replayGuard('belle-online', 'checkout', req(), { challenge: 'one-use' })
  await assert.rejects(replayGuard('belle-online', 'checkout', req(), { challenge: 'one-use' }), { status: 403 })
  for (const fetchImpl of [async () => { throw Error('secret must not leak') }, async () => ({ ok: false }), async () => ({ ok: true, json: async () => { throw Error('not JSON') } })]) {
    await assert.rejects(fixture({ fetchImpl }).guard('belle-online', 'checkout', req(), { challenge: 'token' }), { status: 503 })
  }
})

test('missing secrets/hostnames and production local hostname cannot enable verification bypass', async () => {
  for (const options of [{ secret: '' }, { rateLimitKey: '' }, { expectedHostnames: [] }, { expectedHostnames: ['localhost'] }]) {
    await assert.rejects(fixture(options).guard('belle-online', 'checkout', req(), { challenge: 'token' }), { status: 503 })
  }
  for (const options of [{ demoBypass: true }, { demoBypass: true, emulator: true, projectId: 'pos-shop-owner' }]) assert.throws(() => fixture(options), /isolated demo/)
})

test('distributed request budgets enforce concurrent callers, separate operations and reset windows', async () => {
  let timestamp = 120_001
  const db = database()
  const a = fixture({ db, now: () => timestamp, projectId: 'demo-security', emulator: true, demoBypass: true }).guard
  const b = fixture({ db, now: () => timestamp, projectId: 'demo-security', emulator: true, demoBypass: true }).guard
  const results = await Promise.allSettled(Array.from({ length: 21 }, (_, index) => (index % 2 ? a : b)('belle-online', 'checkout', req(), {})))
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 20)
  const rejection = results.find((r) => r.status === 'rejected').reason
  assert.equal(rejection.status, 429); assert.equal(rejection.retryAfter, 60)
  await a('belle-online', 'track-order', req(), {})
  timestamp = 180_001
  await a('belle-online', 'checkout', req(), {})
  assert.ok([...db.records.keys()].every((path) => path.startsWith('onlineShopV2/belle-online/request_limits/')))
})

test('shop budget cannot be evaded by rotating source addresses; spoofed headers are ignored by default', async () => {
  const { guard } = fixture({ projectId: 'demo-security', emulator: true, demoBypass: true, now: () => 120_000 })
  for (let i = 0; i < 120; i++) await guard('belle-online', 'checkout', { ...req(), socket: { remoteAddress: `192.0.2.${i + 1}` } }, {})
  await assert.rejects(guard('belle-online', 'checkout', { ...req(), socket: { remoteAddress: '198.51.100.1' } }, {}), { status: 429 })
  const request = { headers: { 'x-forwarded-for': '198.51.100.4, 192.0.2.1' }, socket: { remoteAddress: '::ffff:127.0.0.1' } }
  assert.equal(sourceAddress(request), '127.0.0.1')
  assert.equal(sourceAddress(request, 1), '192.0.2.1')
  assert.equal(sourceAddress(request, 2), '198.51.100.4')
})

test('API rate/protection failures and malformed bodies preserve uncertain checkout keys', async () => {
  const run = async (publicGuard, body = {}, path = 'checkout') => {
    const handler = createShopApi({ db: {}, auth: {}, bucket: {}, allowedShopId: 'belle-online', allowedOrigins: ['https://shop.example'], publicGuard })
    let status = 200, data; const headers = {}
    await handler({ ...req(), path: '/belle-online/' + path, method: 'POST', body }, { set(name, value) { headers[name] = value }, status(code) { status = code; return this }, json(value) { data = value } })
    return { status, data, headers }
  }
  for (const status of [403, 429, 503]) {
    const result = await run(async () => { throw Object.assign(new Error('Protection failed'), { status, retryAfter: status === 429 ? 60 : undefined }) })
    assert.equal(result.status, status); assert.equal(result.data.order_rejected, false)
    if (status === 429) assert.equal(result.headers['Retry-After'], '60')
  }
  assert.equal((await run(undefined)).status, 503)
  assert.equal((await run(undefined, { note: 'x'.repeat(65_000) })).status, 413)
})
