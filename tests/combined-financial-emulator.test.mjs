import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createCombinedFinancial } from '../../BelleLocal POS app/functions/src/pos/combined-financial.js'
import { createHistoryService, LEGACY_TABLES } from '../../BelleLocal POS app/functions/src/pos/history.js'
import { createPosCatalog } from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import { createPosOrders } from '../../BelleLocal POS app/functions/src/pos/orders.js'
import { createPosExpenses } from '../../BelleLocal POS app/functions/src/pos/expenses.js'
import { createShopApi } from '../../BelleLocal POS app/functions/src/online-shop/api.js'

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw Error('Combined finance acceptance requires isolated loopback Firebase emulators.')
const require = createRequire(new URL('../../BelleLocal POS app/functions/package.json', import.meta.url))
const { initializeApp, deleteApp } = require('firebase-admin/app'); const { getFirestore } = require('firebase-admin/firestore'); const { getAuth } = require('firebase-admin/auth')
const app = initializeApp({ projectId: 'demo-belle-online' }); const db = getFirestore(); const auth = getAuth()
test.after(async () => { await db.terminate(); await deleteApp(app) })
const at = '2026-10-12T03:00:00.000Z'; const clock = () => Date.parse(at)
const old = (uid, name, key) => db.doc(`users/${uid}/${name}/${key}`)
const next = (shop, name, key) => db.doc(`onlineShopV2/${shop}/${name}/${key}`)
const put = (f, name, key, value) => next(f.shop, name, key).set(value)
const legacyOrder = (total, cost, extra = {}) => ({ date: '2026-07-23', total, amountPaid: total, balanceDue: 0, paymentStatus: 'paid', fulfillmentStatus: 'reserved', customer: { name: 'Fictional historical buyer' }, items: [{ id: 'line', quantity: 1, unitPrice: total, unitCost: cost }], ...extra })
async function originalSnapshot(f) {
  return Object.fromEntries(await Promise.all([...LEGACY_TABLES].map(async (name) => [name, (await db.collection(`users/${f.uid}/${name}`).get()).docs.map((doc) => [doc.id, doc.data()]) ])))
}
async function fixture() {
  const suffix = randomUUID(); const f = { uid: 'financial-' + suffix, shop: 'financial-' + suffix }
  f.history = createHistoryService({ db, ownerUid: f.uid, now: clock }); f.report = createCombinedFinancial({ db, ownerUid: f.uid })
  await old(f.uid, 'orders', 'paid').set(legacyOrder(500, 100))
  await old(f.uid, 'orders', 'unpaid').set(legacyOrder(300, 80, { paymentStatus: 'unpaid', amountPaid: 0, balanceDue: 300 }))
  await old(f.uid, 'payments', 'old-payment').set({ orderId: 'paid', amount: 500, date: '2026-07-23', method: 'KBZ Pay 1', transactionId: '000001' })
  await old(f.uid, 'expenses', 'old-expense').set({ date: '2026-07-23', amount: 20 })
  for (const name of [...LEGACY_TABLES].filter((value) => !['orders', 'payments', 'expenses'].includes(value))) await old(f.uid, name, 'immutable').set({ marker: 'Original fictional evidence' })
  const product = await createPosCatalog({ db }).create(f.shop, { name: 'Actual combined-report producer', price: 1000, cost: 200, units: [{ name: 'Piece', isBase: true, conversionFactor: 1 }], openingStock: { quantity: 3, unitCost: 200 } }, f.uid, randomUUID())
  f.sale = (await createPosOrders({ db, now: clock }).create(f.shop, { saleType: 'IN_STORE', paymentMode: 'FULL', initialPayment: { amount: 1000, method: 'Cash' }, items: [{ productId: product.id, quantity: 1 }] }, f.uid, randomUUID(), { checkout: true })).order
  await createPosExpenses({ db, now: clock }).create(f.shop, { title: 'Actual report expense', amount: 30, category: 'Transport' }, f.uid, randomUUID())
  return f
}
const receive = (f, amount, reference) => f.history.append(f.shop, 'unpaid', { action: 'payment', request_key: randomUUID(), method: 'KBZ Pay 1', date: '2026-10-12', amount, transactionId: reference }, f.uid)
const needsReconcile = (error) => error.status === 409 && error.code === 'HISTORY_RECONCILIATION_REQUIRED'

test('Actual new checkout/expense and original paid-reserved history combine once, using frozen costs with all original collections unchanged', async () => {
  const f = await fixture(); const before = await originalSnapshot(f); const result = await f.report.get(f.shop)
  assert.deepEqual(result.financial.combined, { revenue: 1500, costOfGoods: 300, grossProfit: 1200, operatingExpenses: 50, netProfit: 1150 })
  assert.equal(result.financial.legacy.revenue, 500); assert.equal(result.financial.retails.netRevenue, 1000)
  assert.equal(result.financial.legacyDelta.revenue, 0); assert.equal(result.counts.overlayPayments, 0)
  assert.equal(result.readOnly, true); assert.equal(result.snapshotHash.length, 64)
  assert.ok(result.evidence.some((entry) => entry.path === old(f.uid, 'orders', 'paid').path))
  assert.deepEqual(await originalSnapshot(f), before)
})

test('Actual deposit/final payment and completion overlays recognize the original sale exactly once; duplicate retry cannot add receipts or revenue', async () => {
  const f = await fixture(); const before = await originalSnapshot(f)
  await receive(f, 100, '000002'); assert.equal((await f.report.get(f.shop)).financial.combined.revenue, 1500)
  const request = { action: 'complete', request_key: randomUUID() }
  await f.history.append(f.shop, 'unpaid', request, f.uid)
  const final = await receive(f, 200, '000003'); let report = await f.report.get(f.shop)
  assert.equal(report.financial.legacy.revenue, 800); assert.equal(report.financial.combined.revenue, 1800)
  assert.equal(report.financial.combined.netProfit, 1370); assert.equal(report.counts.overlayPayments, 2)
  assert.deepEqual(await f.history.append(f.shop, 'unpaid', request, f.uid), (await f.history.order(f.shop, 'unpaid')).events[1].result)
  report = await f.report.get(f.shop); assert.equal(report.financial.combined.revenue, 1800); assert.equal(report.counts.overlayPayments, 2)
  assert.equal(final.paymentStatus, 'paid'); assert.deepEqual(await originalSnapshot(f), before)
  const history = await f.history.read(f.shop); assert.equal(history.financial.effective.revenue, 800); assert.equal(history.payments.length, 3)
})

test('Legacy sale-date recognition, Retails completion/refund dates and Yangon midnight are independent; missing dates stay visible and are excluded from bounded ranges', async () => {
  const f = await fixture(); await receive(f, 300, '000004')
  const july = await f.report.get(f.shop, { from: '2026-07-23', to: '2026-07-23' }); assert.equal(july.financial.combined.revenue, 800); assert.equal(july.financial.combined.netProfit, 600)
  const october = await f.report.get(f.shop, { from: '2026-10-12', to: '2026-10-12' }); assert.equal(october.financial.combined.revenue, 1000); assert.equal(october.financial.combined.operatingExpenses, 30)
  await put(f, 'pos_orders', 'boundary', { fulfillmentStatus: 'completed', total: 100, completedAt: '2026-10-11T17:30:00.000Z', items: [{ quantity: 1, unitCost: 10 }] })
  await put(f, 'pos_orders', 'before-boundary', { fulfillmentStatus: 'completed', total: 200, completedAt: '2026-10-11T17:29:59.999Z', items: [{ quantity: 1, unitCost: 10 }] })
  await old(f.uid, 'orders', 'undated').set({ ...legacyOrder(50, 5), date: null })
  assert.equal((await f.report.get(f.shop)).financial.combined.revenue, 2150)
  const filtered = await f.report.get(f.shop, { from: '2026-10-12', to: '2026-10-12' }); assert.equal(filtered.financial.combined.revenue, 1100)
  assert.ok(filtered.warnings.some((entry) => entry.path.endsWith('/undated')))
  for (const query of [{ from: '2026-02-30' }, { to: 'invalid' }, { from: '2026-10-12', to: '2026-07-23' }]) await assert.rejects(f.report.get(f.shop, query), (error) => error.status === 400)
})

test('Namespace ID collisions do not turn legacy receipts into new refunds; source cancelled/preorder/refunded and expense policies remain distinct', async () => {
  const f = await fixture(); await receive(f, 300, '000005')
  // Relationship/date edge fixtures, not claims of production migration.
  await put(f, 'pos_orders', 'unpaid', { fulfillmentStatus: 'completed', total: 100, completedAt: at, items: [{ quantity: 1, unitCost: 20 }] })
  for (const status of ['preorder', 'cancelled']) await old(f.uid, 'orders', status).set(legacyOrder(9000, 900, { fulfillmentStatus: status }))
  await old(f.uid, 'orders', 'refunded').set(legacyOrder(9000, 900, { paymentStatus: 'refunded' }))
  await old(f.uid, 'expenses', 'old-income').set({ amount: 10, date: '2026-07-23', category: 'income', cancelledAt: at })
  await put(f, 'pos_expenses', 'income', { amount: 9000, category: ' Income ', spentAt: at, cancelledAt: null })
  await put(f, 'pos_expenses', 'cancelled', { amount: 9000, category: 'Rent', spentAt: at, cancelledAt: at })
  await put(f, 'pos_payments', 'refund', { orderId: f.sale.id, amount: -100, type: 'refund', paidAt: '2026-10-13T03:00:00Z' })
  const result = await f.report.get(f.shop); assert.equal(result.financial.legacy.revenue, 800); assert.equal(result.financial.retails.netRevenue, 1000)
  assert.equal(result.financial.retails.refunds, 100); assert.equal(result.financial.combined.revenue, 1800); assert.equal(result.financial.combined.operatingExpenses, 60)
  assert.equal((await f.report.get(f.shop, { from: '2026-10-13', to: '2026-10-13' })).financial.combined.revenue, -100)
})

test('Changed source/head/event/receipt, missing source and orphan evidence fail closed without repairing or rewriting immutable history', async () => {
  for (const target of ['source', 'head', 'event', 'receipt', 'orphan', 'missing-source', 'missing-head']) {
    const f = await fixture(); const payment = await receive(f, 300, '000006')
    if (target === 'source') await old(f.uid, 'orders', 'unpaid').update({ total: 301 })
    if (target === 'head') await next(f.shop, 'legacy_heads', 'unpaid').update({ amountPaid: 299 })
    if (target === 'event') await next(f.shop, 'legacy_events', payment.event_id).update({ version: 2 })
    if (target === 'receipt') await next(f.shop, 'pos_payments', payment.paymentId).update({ amount: 299 })
    if (target === 'orphan') await put(f, 'pos_payments', 'orphan', { source: 'legacy-overlay', orderId: 'missing', amount: 1 })
    if (target === 'missing-source') await old(f.uid, 'orders', 'unpaid').delete()
    if (target === 'missing-head') await next(f.shop, 'legacy_heads', 'unpaid').delete()
    const before = await originalSnapshot(f); await assert.rejects(f.report.get(f.shop), needsReconcile); assert.deepEqual(await originalSnapshot(f), before)
    // The history reader still exposes the source records even when the strict
    // combined calculation is unavailable.
    assert.equal((await f.history.read(f.shop)).orders.length, target === 'missing-source' ? 1 : 2)
  }
})

test('Invalid stored numeric evidence cannot produce NaN/null totals; valid fractional source COGS retains source rounding', async () => {
  const f = await fixture(); await put(f, 'pos_orders', 'fractional', { fulfillmentStatus: 'completed', total: 500, completedAt: at, items: [{ quantity: 1, baseQuantity: '1.005', unitCost: 100 }, { quantity: 1, costValue: '0.4' }] })
  assert.equal((await f.report.get(f.shop)).financial.retails.costOfGoods, 301)
  await old(f.uid, 'expenses', 'bad').set({ date: '2026-07-23', amount: NaN })
  const before = await originalSnapshot(f); await assert.rejects(f.report.get(f.shop), needsReconcile); assert.deepEqual(await originalSnapshot(f), before)
})

test('Source direct/COD-allocation/fallback refund identity precedence cannot misjoin legacy IDs or include settlement voids', async () => {
  const f = await fixture(); const before = await originalSnapshot(f)
  await put(f, 'pos_payments', 'allocated-refund', { orderId: null, orderIds: '["paid"]', allocations: JSON.stringify([{ orderId: f.sale.id, amount: 100 }]), amount: -100, type: 'refund', paidAt: at })
  await put(f, 'pos_payments', 'void', { orderId: f.sale.id, amount: -900, type: 'refund', scope: 'cod-settlement-void', paidAt: at })
  assert.equal((await f.report.get(f.shop)).financial.combined.revenue, 1400)
  await put(f, 'pos_payments', 'direct', { orderId: f.sale.id, allocations: 'unused malformed evidence', amount: -25, type: 'refund', paidAt: at })
  assert.equal((await f.report.get(f.shop)).financial.combined.revenue, 1375)
  await put(f, 'pos_payments', 'fallback', { orderId: null, allocations: '[]', orderIds: JSON.stringify([f.sale.id]), amount: -25, type: 'refund', paidAt: at })
  assert.equal((await f.report.get(f.shop)).financial.combined.revenue, 1350)
  await next(f.shop, 'pos_payments', 'fallback').update({ orderIds: 'malformed' }); await assert.rejects(f.report.get(f.shop), needsReconcile)
  assert.deepEqual(await originalSnapshot(f), before)
})

test('Historical worklist reads one read-only transaction and reconciles a final payment under its existing contract', async () => {
  const f = await fixture(); await receive(f, 300, '000007'); let reads = 0; let transactions = 0
  const observed = { collection: db.collection.bind(db), runTransaction: (fn, options) => {
    assert.equal(options.readOnly, true); transactions++
    return db.runTransaction((tx) => fn({ get: (reference) => { reads++; return tx.get(reference) } }), options)
  } }
  const result = await createHistoryService({ db: observed, ownerUid: f.uid }).read(f.shop, { search: 'unpaid' })
  assert.equal(transactions, 1); assert.equal(reads, 5); assert.equal(result.total, 1); assert.equal(result.orders[0].paymentStatus, 'paid'); assert.equal(result.financial.effective.revenue, 800)
})

test('Actual API handler with real Firebase Auth tokens restricts financial reads to its fixed owner/shop; bad queries and stale source expose typed errors', async () => {
  const f = await fixture(); const email = `${f.uid}@belle-demo.example`
  await auth.createUser({ uid: f.uid, email, password: 'Local-test-only-123!' })
  const signIn = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Local-test-only-123!', returnSecureToken: true }) })
  assert.equal(signIn.status, 200); const token = (await signIn.json()).idToken
  const outsiderId = 'other-' + randomUUID(); const outsiderEmail = outsiderId + '@belle-demo.example'
  await auth.createUser({ uid: outsiderId, email: outsiderEmail, password: 'Local-test-only-123!' })
  const outsiderLogin = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: outsiderEmail, password: 'Local-test-only-123!', returnSecureToken: true }) })
  assert.equal(outsiderLogin.status, 200); const outsider = (await outsiderLogin.json()).idToken
  const handler = createShopApi({ db, auth, allowedShopId: f.shop, ownerUid: f.uid })
  // Isolated HTTP instance uses the identical handler and actual emulator
  // tokens. It never changes the running Functions shop/owner configuration.
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'); req.path = url.pathname; req.query = Object.fromEntries(url.searchParams)
    res.set = (key, value) => res.setHeader(key, value); res.status = (value) => { res.statusCode = value; return res }
    res.json = (value) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }; res.send = (value) => res.end(value)
    void handler(req, res)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const root = `http://127.0.0.1:${server.address().port}/${f.shop}/admin/history/financial`
  const request = async (path = '', bearer = token) => { const response = await fetch(root + path, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} }); return { status: response.status, data: await response.json() } }
  try {
    assert.equal((await request('', null)).status, 401); assert.equal((await request('', 'invalid')).status, 401)
    assert.equal((await request('', outsider)).status, 403)
    assert.equal((await fetch(root.replace(f.shop, 'wrong-shop'), { headers: { Authorization: `Bearer ${token}` } })).status, 404)
    assert.equal((await request('?ownerUid=some-other-owner')).data.financial.legacy.revenue, 500)
    assert.equal((await request('?from=2026-02-30')).status, 400)
    await receive(f, 300, '000008'); assert.equal((await request()).data.financial.combined.revenue, 1800)
    await old(f.uid, 'orders', 'unpaid').update({ total: 301 }); const failed = await request(); assert.equal(failed.status, 409); assert.equal(failed.data.code, 'HISTORY_RECONCILIATION_REQUIRED')
  } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
})

test('Running Functions front door rejects anonymous/outsider requests and fails closed on its own orphan demo evidence instead of emitting combined totals', async () => {
  async function token(uid, email) {
    try { await auth.createUser({ uid, email, password: 'Local-test-only-123!' }) } catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error }
    const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Local-test-only-123!', returnSecureToken: true }) })
    assert.equal(response.status, 200); return (await response.json()).idToken
  }
  const owner = await token('demo-owner', 'owner@belle-demo.example'); const outsider = await token('demo-other', 'other@belle-demo.example')
  const before = await originalSnapshot({ uid: 'demo-owner' })
  const url = 'http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/history/financial'
  const request = async (bearer) => { const response = await fetch(url, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} }); return { status: response.status, data: await response.json() } }
  assert.equal((await request()).status, 401); assert.equal((await request(outsider)).status, 403)
  // Own only this fictional sidecar: no dependence on fixtures from another suite.
  const orphan = next('belle-online', 'legacy_events', 'test-orphan-' + randomUUID())
  await orphan.set({ order_id: 'missing-' + randomUUID(), version: 1, action: 'complete', shop_id: 'belle-online', actor_uid: 'demo-owner' })
  try {
    const result = await request(owner); assert.equal(result.status, 409, JSON.stringify(result.data)); assert.equal(result.data.code, 'HISTORY_RECONCILIATION_REQUIRED'); assert.equal(result.data.financial, undefined)
    assert.deepEqual(await originalSnapshot({ uid: 'demo-owner' }), before)
  } finally { await orphan.delete() }
})
