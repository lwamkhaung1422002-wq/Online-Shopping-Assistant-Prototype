import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMainReadonlyHandler } from '../../BelleLocal POS app/functions/src/main-readonly/api.js'
import { createReadonlyFirestore } from '../../BelleLocal POS app/functions/src/main-readonly/firestore.js'
import { assertMainReadonlyStartup } from '../../BelleLocal POS app/functions/src/main-readonly/startup.js'

const owner = 'UXRbRF184gcohMkl4CdS0i0rdow2'
const shop = 'belle-online'
const origin = 'http://127.0.0.1:5177'
const orderId = 'QqCHl8BRInz67ZomN9jY'
const originalPath = `users/${owner}/orders/${orderId}`
const original = {
  id: 'original-internal-id', date: '2026-07-23',
  customer: { name: 'Fixture buyer', phone: '09000000000', city: 'Yangon' },
  total: 34500, subtotal: 34500, amountPaid: 0, balanceDue: 34500,
  paymentStatus: 'unpaid', fulfillmentStatus: 'reserved', schemaVersion: 2,
  items: [{ id: 'line', type: 'Elegence', size: '1', color: 'Brown', quantity: 1,
    unitPrice: 39500, unitCost: 39500, discount: 5000,
    allocations: [{ stockBatchId: 'legacy-batch', quantity: 1, unitCost: 39500 }] }],
  remark: 'immutable note', unknownAuditField: { keep: true },
}

// In-memory Firestore double. No Admin SDK, network, emulator or credentials.
function database(entries = []) {
  const copy = (value) => {
    if (value === null || typeof value !== 'object') return value
    if (typeof value.get === 'function' && value.firestore) return value
    if (Array.isArray(value)) return value.map(copy)
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copy(entry)]))
  }
  const records = new Map(entries.map(([path, value]) => [path, copy(value)]))
  const reads = [], writes = [], transactions = []
  const write = (name) => (...args) => { writes.push([name, ...args]); throw Error('Raw database write reached') }
  const snapshot = (path) => ({
    id: path.split('/').at(-1), exists: records.has(path), ref: doc(path),
    data: () => copy(records.get(path)),
    get: (field) => copy(records.get(path)?.[field]),
  })
  function doc(path) {
    return { path, id: path.split('/').at(-1), firestore: db, parent: { firestore: db }, _raw: db,
      get: async () => { reads.push(path); return snapshot(path) },
      collection: (name) => collection(`${path}/${name}`),
      set: write('set'), create: write('create'), update: write('update'), delete: write('delete'),
    }
  }
  function collection(path, options = {}) {
    const query = {
      path, id: path.split('/').at(-1), firestore: db, parent: { firestore: db }, _raw: db,
      doc: (key) => doc(`${path}/${key}`), add: write('add'),
      where: (field, op, value) => collection(path, { ...options, filters: [...(options.filters || []), [field, op, value]] }),
      orderBy: (field, direction = 'asc') => collection(path, { ...options, sort: [field, direction] }),
      limit: (count) => collection(path, { ...options, limit: count }),
      startAfter: (value) => collection(path, { ...options, after: value }),
      async get() {
        reads.push(path)
        let docs = [...records.keys()].filter((key) => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1).map(snapshot)
        for (const [field, op, expected] of options.filters || []) {
          docs = docs.filter((record) => {
            const value = field === '__name__' ? record.id : record.data()?.[field]
            if (op === '==') return value === expected
            if (op === '!=') return value != null && value !== expected
            if (op === '>=') return value >= expected
            if (op === '<') return value < expected
            if (op === 'in') return expected.includes(value)
            throw Error(`Unexpected query operator ${op}`)
          })
        }
        const [field, direction] = options.sort || ['__name__', 'asc']
        docs.sort((a, b) => {
          const value = (record) => field === '__name__' ? record.id : record.data()?.[field]
          return String(value(a)).localeCompare(String(value(b))) * (direction === 'desc' ? -1 : 1)
        })
        if (options.after) docs = docs.filter((record) => record.id > options.after)
        if (options.limit !== undefined) docs = docs.slice(0, options.limit)
        return { docs, size: docs.length, empty: docs.length === 0, query, forEach: (callback) => docs.forEach(callback) }
      },
    }
    return query
  }
  const db = {
    records, reads, writes, transactions, doc, collection,
    getAll: (...refs) => Promise.all(refs.map((ref) => ref.get())),
    async runTransaction(callback, options) {
      transactions.push(options)
      return callback({ get: (ref) => ref.get(), getAll: (...refs) => Promise.all(refs.map((ref) => ref.get())),
        set: write('transaction.set'), create: write('transaction.create'), update: write('transaction.update'), delete: write('transaction.delete'),
        firestore: db, _raw: db,
      })
    },
    batch: write('batch'), bulkWriter: write('bulkWriter'), recursiveDelete: write('recursiveDelete'),
    collectionGroup: write('collectionGroup'),
  }
  return db
}

function fixture(entries = [[originalPath, original]]) {
  const db = database(entries), verified = []
  const auth = {
    async verifyIdToken(token, revoked) {
      verified.push([token, revoked])
      if (token === 'invalid') throw Object.assign(Error('Invalid token'), { code: 'auth/invalid-id-token' })
      if (token === 'backend-failure') throw Object.assign(Error('Private backend quota configuration detail'), { code: 'auth/internal-error' })
      if (token === 'missing-uid-token') return {}
      return { uid: token === 'owner-token' ? owner : 'outsider' }
    },
    async getUser(uid) { return { uid, displayName: 'Fixture owner' } },
  }
  const handler = createMainReadonlyHandler({ db, auth, now: () => Date.parse('2026-10-13T03:00:00Z') })
  async function request(path, { method = 'GET', token = 'owner-token', headers = {}, query = {}, urlOnly = false } = {}) {
    let status = 200, data
    const responseHeaders = {}
    const res = {
      set(name, value) { responseHeaders[String(name).toLowerCase()] = value; return this },
      status(code) { status = code; return this },
      json(value) { data = value; return this },
      send(value) { data = value; return this },
    }
    await handler({ path: urlOnly ? undefined : path, url: path, method, query: urlOnly ? undefined : query,
      headers: { origin, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } }, res)
    return { status, data, headers: responseHeaders }
  }
  return { db, auth, verified, request }
}

test('each allowed read requires a revoked-token check and the fixed MAIN owner before database access', async () => {
  const paths = ['/shops', `/${shop}/admin/me`, `/${shop}/admin/pos/profile`, `/${shop}/admin/history`,
    `/${shop}/admin/history/financial`, `/${shop}/admin/history/stock`, `/${shop}/admin/history/records/orders`,
    `/${shop}/admin/history/orders/${orderId}`, `/${shop}/admin/pos/dashboard`,
    `/${shop}/admin/pos/reports/sales`, `/${shop}/admin/pos/reports/payments`]
  for (const path of paths) {
    for (const [token, expected] of [[null, 401], ['invalid', 401], ['missing-uid-token', 403], ['other-token', 403]]) {
      const f = fixture()
      assert.equal((await f.request(path, { token })).status, expected, path)
      assert.deepEqual(f.db.reads, [], path)
      assert.deepEqual(f.db.writes, [], path)
      assert.deepEqual(f.verified, token ? [[token, true]] : [], path)
    }
  }
})

test('backend owner verification failures do not blame the owner session or read source records', async () => {
  const f = fixture()
  const result = await f.request(`/${shop}/admin/pos/profile`, { token: 'backend-failure' })
  assert.equal(result.status, 503)
  assert.equal(result.data.code, 'MAIN_AUTH_UNAVAILABLE')
  assert.doesNotMatch(JSON.stringify(result.data), /Private|quota configuration|expired|Invalid/)
  assert.deepEqual(f.verified, [['backend-failure', true]])
  assert.deepEqual(f.db.reads, [])
  assert.deepEqual(f.db.writes, [])
})

test('authenticated original record and order reads preserve known order values and all stored documents', async () => {
  const f = fixture(), before = structuredClone([...f.db.records])
  const records = await f.request(`/${shop}/admin/history/records/orders?page_size=25`, { urlOnly: true })
  assert.equal(records.status, 200, JSON.stringify(records.data))
  assert.deepEqual(records.data.records[0], { ...original, id: orderId, _source: records.data.records[0]._source })
  assert.equal(records.data.records[0]._source.path, originalPath)
  assert.equal(records.data.records[0]._source.immutable, true)
  assert.match(records.data.records[0]._source.sha256, /^[a-f0-9]{64}$/)
  const order = await f.request(`/${shop}/admin/history/orders/${orderId}`)
  assert.equal(order.status, 200, JSON.stringify(order.data))
  assert.deepEqual(order.data.original, { ...original, id: orderId })
  assert.equal(order.data.effective.total, 34500)
  assert.equal(order.data.effective.items[0].unitCost, 39500)
  assert.equal(order.data.effective.items[0].discount, 5000)
  assert.equal(order.data.effective.balanceDue, 34500)
  assert.equal(order.data.source.path, originalPath)
  assert.equal(order.data.source.immutable, true)
  assert.deepEqual(order.data.events, [])
  assert.deepEqual(f.verified, [['owner-token', true], ['owner-token', true]])
  assert.deepEqual([...f.db.records], before)
  assert.deepEqual(f.db.writes, [])
})

test('absent MAIN profile and stock baseline return read-only views without bootstrapping documents', async () => {
  const f = fixture(), before = structuredClone([...f.db.records])
  const profile = await f.request(`/${shop}/admin/pos/profile`)
  assert.equal(profile.status, 200, JSON.stringify(profile.data))
  assert.equal(profile.data.shop.id, shop)
  assert.equal(profile.data.shop.ownerId, owner)
  assert.equal(profile.data.shop.readOnly, true)
  const shops = await f.request('/shops')
  assert.equal(shops.status, 200, JSON.stringify(shops.data))
  const rows = Array.isArray(shops.data) ? shops.data : shops.data.shops
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, shop)
  assert.equal(rows[0].readOnly, true)
  const stock = await f.request(`/${shop}/admin/history/stock`)
  assert.equal(stock.status, 200, JSON.stringify(stock.data))
  assert.equal(stock.data.authority, false)
  for (const route of ['history/financial', 'pos/dashboard', 'pos/reports/sales', 'pos/reports/payments']) {
    const result = await f.request(`/${shop}/admin/${route}`)
    assert.equal(result.status, 200, `${route}: ${JSON.stringify(result.data)}`)
  }
  assert.ok(f.db.transactions.length > 0)
  assert.ok(f.db.transactions.every((options) => options.readOnly === true))
  assert.deepEqual([...f.db.records], before)
  assert.deepEqual(f.db.writes, [])
})

test('conflicting existing shop ownership stops profile and history reads without changing documents', async () => {
  for (const path of [`onlineShopV2/${shop}`, `onlineShopV2/${shop}/pos_shop/main`]) {
    const f = fixture([[originalPath, original], [path, { ownerId: 'outsider' }]])
    const before = structuredClone([...f.db.records])
    for (const route of ['/shops', `/${shop}/admin/pos/profile`, `/${shop}/admin/history/orders/${orderId}`]) {
      const result = await f.request(route)
      assert.equal(result.status, 409, route)
      assert.equal(result.data.code, 'READONLY_RECONCILIATION_REQUIRED')
    }
    assert.equal(f.db.reads.includes(originalPath), false)
    assert.deepEqual([...f.db.records], before)
    assert.deepEqual(f.db.writes, [])
    assert.ok(f.db.transactions.every((options) => options.readOnly === true))
  }
})

test('a failed database read returns a generic availability error without private SDK details', async () => {
  const f = fixture(), privateDetail = 'Fixture customer 09000000000 private-account@example.test'
  let attempted = false
  f.db.runTransaction = async () => {
    attempted = true
    throw Object.assign(Error(privateDetail), { code: 'fake-sdk-private-error', details: privateDetail })
  }
  const result = await f.request(`/${shop}/admin/history/orders/${orderId}`)
  assert.equal(attempted, true)
  assert.equal(result.status, 503)
  assert.match(result.data.error, /MAIN read-only records are unavailable/)
  const payload = JSON.stringify(result.data)
  assert.equal(payload.includes(privateDetail), false)
  assert.equal(payload.includes('fake-sdk-private-error'), false)
  assert.equal(result.data.details, undefined)
  assert.deepEqual(f.db.writes, [])
})

test('exact route, mutation and CORS allowlists reject requests before database reads', async () => {
  const f = fixture()
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'HEAD']) {
    assert.equal((await f.request(`/${shop}/admin/history`, { method })).status, 405)
  }
  for (const path of [`/${shop}/catalog`, `/${shop}/checkout`, '/managed-shop/admin/me',
    `/${shop}/admin/history/orders/${orderId}/events`, `/${shop}/admin/pos/settings`,
    `/${shop}/admin/history/records/users`, `/${shop}/admin/history/records/orders/extra`,
    `/${shop}/admin/me/extra`, '//shops']) {
    assert.equal((await f.request(path)).status, 404, path)
  }
  for (const value of ['http://localhost:5177', 'http://127.0.0.1:5178', 'https://127.0.0.1:5177', 'https://example.com', 'null']) {
    assert.equal((await f.request(`/${shop}/admin/me`, { headers: { origin: value } })).status, 403, value)
  }
  assert.deepEqual(f.db.reads, [])
  assert.deepEqual(f.db.writes, [])
})

test('preflight permits only the local GET route and the authorization/content-type headers', async () => {
  const f = fixture()
  const preflight = (path, headers) => f.request(path, { method: 'OPTIONS', token: null,
    headers: { 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization, content-type', ...headers } })
  const allowed = await preflight(`/${shop}/admin/history`)
  assert.equal(allowed.status, 204)
  assert.equal(allowed.headers['access-control-allow-origin'], origin)
  assert.equal(allowed.headers['access-control-allow-methods'], 'GET')
  assert.equal((await preflight(`/${shop}/checkout`)).status, 404)
  assert.equal((await preflight(`/${shop}/admin/history`, { 'access-control-request-method': 'POST' })).status, 403)
  assert.equal((await preflight(`/${shop}/admin/history`, { 'access-control-request-headers': 'authorization, x-demo-owner' })).status, 403)
  assert.equal((await preflight(`/${shop}/admin/history`, { origin: 'http://localhost:5177' })).status, 403)
  assert.deepEqual(f.verified, [])
  assert.deepEqual(f.db.reads, [])
})

test('Firestore facade scopes documents and queries, wraps snapshot references and blocks all writes', async () => {
  const raw = database([[originalPath, original]])
  const db = createReadonlyFirestore(raw)
  for (const path of [`users/outsider/orders/${orderId}`, `users/${owner}/secret/main`,
    `onlineShopV2/managed-shop/pos_orders/main`, `onlineShopV2/${shop}/request_limits/main`,
    `onlineShopV2/${shop}/pos_orders/main/secret/child`]) assert.throws(() => db.doc(path), path)
  for (const path of ['users', `users/${owner}`, `users/${owner}/secret`, 'onlineShopV2',
    `onlineShopV2/managed-shop/pos_orders`, `onlineShopV2/${shop}/request_limits`]) assert.throws(() => db.collection(path), path)
  const ref = db.doc(originalPath), query = db.collection(`users/${owner}/orders`).orderBy('__name__').limit(25)
  const saved = await ref.get(), results = await query.get()
  assert.equal(saved.ref.path, originalPath)
  assert.equal(results.docs[0].ref.path, originalPath)
  assert.deepEqual(saved.data(), original)
  const nestedPath = `users/${owner}/meta/reference-fixture`
  raw.records.set(nestedPath, { nested: { ref: raw.doc(originalPath) }, refs: [raw.doc(originalPath)] })
  const nested = (await db.doc(nestedPath).get()).data()
  for (const value of [nested.nested.ref, nested.refs[0]]) {
    assert.deepEqual(value, { path: originalPath, id: orderId })
    assert.equal(value.firestore, undefined)
    assert.equal(value.parent, undefined)
    assert.equal(value._raw, undefined)
    assert.equal(value.set, undefined)
    assert.equal(value.delete, undefined)
    assert.ok(Object.isFrozen(value))
  }
  for (const wrapped of [db, ref, query, saved.ref, results.docs[0].ref]) {
    for (const key of ['firestore', 'parent', '_raw', '_firestore', '_queryOptions']) assert.equal(wrapped[key], undefined, key)
  }
  for (const method of ['set', 'create', 'update', 'delete']) {
    assert.throws(() => ref[method]({ total: 1 }))
    assert.throws(() => saved.ref[method]({ total: 1 }))
  }
  for (const method of ['batch', 'bulkWriter', 'recursiveDelete', 'collectionGroup']) assert.throws(() => db[method]('orders'))
  assert.throws(() => db.collection(`users/${owner}/orders`).add({ total: 1 }))
  await db.runTransaction(async (tx) => {
    assert.equal(tx.firestore, undefined)
    assert.equal(tx._raw, undefined)
    assert.equal((await tx.get(ref)).ref.path, originalPath)
    assert.equal((await tx.get(query)).docs[0].ref.path, originalPath)
    await assert.rejects(tx.get(raw.doc(originalPath)), { status: 403 })
    for (const method of ['set', 'create', 'update', 'delete']) assert.throws(() => tx[method](ref, { total: 1 }))
  }, { readOnly: false, maxAttempts: 3 })
  assert.equal(raw.transactions[0].readOnly, true)
  assert.deepEqual(raw.writes, [])
  assert.deepEqual(raw.records.get(originalPath), original)
})

test('startup requires explicit live execution and existing ADC, and refuses emulator or mismatched project configuration', () => {
  const credentialPath = join('C:', 'fixture', 'main-adc.json')
  const env = { GOOGLE_APPLICATION_CREDENTIALS: credentialPath }
  const invoke = (args = ['--run-live'], extra = {}, stat = (path) => {
    if (path !== credentialPath) throw Error('Missing fixture credentials')
    return { isFile: () => true }
  }) => assertMainReadonlyStartup({ args, env: { ...env, ...extra }, stat })
  let credentialChecks = 0
  const countCredentials = () => { credentialChecks++; return { isFile: () => true } }
  for (const args of [[], ['--run-live', '--demo'], ['--demo']]) assert.throws(() => invoke(args, {}, countCredentials), /Use --run-live/)
  assert.throws(() => invoke(['--run-live'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, countCredentials), /demo\/emulator/)
  assert.equal(credentialChecks, 0)
  assert.throws(() => invoke(['--run-live'], {}, () => { throw Error('Missing fixture credentials') }))
  assert.throws(() => invoke(['--run-live'], {}, () => ({ isFile: () => false })), /Credentials are unavailable/)
  for (const extra of [{ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
    { FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9000' }, { FUNCTIONS_EMULATOR: 'true' },
    { VITE_FIREBASE_DEMO_PROJECT: 'demo-belle-online' },
    { GCLOUD_PROJECT: 'demo-belle-online' }, { GOOGLE_CLOUD_PROJECT: 'other-project' }, { GOOGLE_CLOUD_QUOTA_PROJECT: 'other-project' },
    { FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-belle-online' }) }, { FIREBASE_CONFIG: JSON.stringify({ projectId: 'other-project' }) },
    { FIREBASE_CONFIG: 'invalid JSON' }]) {
    assert.throws(() => invoke(['--run-live'], extra), JSON.stringify(extra))
  }
  const explicit = invoke()
  assert.equal(typeof explicit === 'string' ? explicit : explicit.credentialPath, credentialPath)
  const appData = join('C:', 'fixture', 'AppData'), defaultPath = join(appData, 'gcloud', 'application_default_credentials.json')
  const defaults = assertMainReadonlyStartup({ args: ['--run-live'], env: { APPDATA: appData }, stat: (path) => ({ isFile: () => path === defaultPath }) })
  assert.equal(typeof defaults === 'string' ? defaults : defaults.credentialPath, defaultPath)
})

test('server entry preflight exits before SDK imports or binding for missing authorization, emulator environment and missing ADC', () => {
  const server = fileURLToPath(new URL('../../BelleLocal POS app/functions/src/main-readonly/server.mjs', import.meta.url))
  const credentialPath = join(tmpdir(), `belle-readonly-missing-${randomUUID()}.json`)
  assert.equal(existsSync(credentialPath), false)
  const env = { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: credentialPath }
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST',
    'FIREBASE_STORAGE_EMULATOR_HOST', 'PUBSUB_EMULATOR_HOST', 'DATABASE_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST',
    'FIREBASE_EMULATOR_HUB', 'FUNCTIONS_EMULATOR', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT',
    'FIREBASE_PROJECT_ID', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_DEMO_PROJECT', 'FIREBASE_CONFIG', 'GOOGLE_CLOUD_QUOTA_PROJECT']) delete env[key]
  const scenarios = [
    { args: [], env, reason: /Use --run-live/ },
    { args: ['--run-live'], env: { ...env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, reason: /demo\/emulator/ },
    { args: ['--run-live'], env, reason: /Credentials are unavailable/ },
  ]
  for (const scenario of scenarios) {
    const result = spawnSync(process.execPath, [server, ...scenario.args], { env: scenario.env, encoding: 'utf8', timeout: 5000, windowsHide: true })
    assert.equal(result.status, 2, result.stderr)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /No database request made/)
    assert.match(result.stderr, scenario.reason)
  }
  assert.equal(existsSync(credentialPath), false)
})
