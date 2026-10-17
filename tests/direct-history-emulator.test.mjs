import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createDirectHistoryClient } from '../../BelleLocal POS app/src/features/firebase-direct/history-client.js'
import { createDirectReadRepository } from '../../BelleLocal POS app/src/features/firebase-direct/read-repository.js'
import { MAIN_OWNER_UID } from '../../BelleLocal POS app/src/features/firebase-direct/content-model.js'
import { legacySourceHash, LEGACY_TABLES } from '../../BelleLocal POS app/functions/src/pos/history.js'
import { sha256Hex } from '../../BelleLocal POS app/src/shared/pos-domain/hashing.js'
const require = createRequire(new URL('../../BelleLocal POS app/package.json', import.meta.url)), sdk = require('firebase/firestore')
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing')
if (process.env.DIRECT_FIRESTORE_EMULATOR !== '127.0.0.1:8088') throw Error('Use the isolated direct emulator.')
const environment = await initializeTestEnvironment({ projectId: 'demo-belle-direct-history', firestore: { host: '127.0.0.1', port: 8088, rules: await readFile(new URL('../../BelleLocal POS app/config/firebase/firestore.direct.rules', import.meta.url), 'utf8') } })
test.after(() => environment.cleanup())
const root = 'onlineShopV2/belle-online', original = table => `users/${MAIN_OWNER_UID}/${table}`, owner = () => environment.authenticatedContext(MAIN_OWNER_UID).firestore()
const client = db => createDirectHistoryClient({ db, auth: { currentUser: { uid: MAIN_OWNER_UID } }, sdk })
const order = (price, cost, extra = {}) => ({ date: '2026-07-23', total: price, amountPaid: price, balanceDue: 0, paymentStatus: 'paid', fulfillmentStatus: 'reserved', customer: { name: 'Fictional historical buyer', phone: '09900000000' }, items: [{ id: 'line', quantity: 1, unitPrice: price, unitCost: cost, type: 'Elegence', size: 'Size 1', color: 'Brown' }], ...extra })
async function fixture() {
  await environment.clearFirestore()
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore(), batch = sdk.writeBatch(db)
    batch.set(sdk.doc(db, `${original('orders')}/paid`), order(500, 100))
    batch.set(sdk.doc(db, `${original('orders')}/QqCHl8BRInz67ZomN9jY`), order(34500, 12000, { paymentStatus: 'unpaid', amountPaid: 0, balanceDue: 34500, customer: { name: 'Yu Thandar Win', phone: '09942988167' } }))
    batch.set(sdk.doc(db, `${original('payments')}/old-payment`), { orderId: 'paid', amount: 500, date: '2026-07-23', method: 'KBZ Pay 1', transactionId: '000001' })
    batch.set(sdk.doc(db, `${original('expenses')}/old-expense`), { date: '2026-07-23', amount: 20 })
    batch.set(sdk.doc(db, `${original('stocks')}/batch`), { quantity: 2, type: 'Elegence', size: 'Size 1', color: 'Brown' })
    batch.set(sdk.doc(db, `${root}/pos_orders/sale`), { fulfillmentStatus: 'completed', subtotal: 1000, discount: 0, total: 1000, completedAt: '2026-10-14T03:00:00Z', items: [{ id: 'sale-item', quantity: 1, unitPrice: 1000, unitCost: 200, lineTotal: 1000 }] })
    batch.set(sdk.doc(db, `${root}/pos_expenses/expense`), { amount: 30, spentAt: '2026-10-14T03:00:00Z' })
    for (let index = 0; index < 27; index++) batch.set(sdk.doc(db, `${original('catalog')}/item-${String(index).padStart(2, '0')}`), { name: `Design ${index}` })
    await batch.commit()
  })
}
async function immutableSnapshot(db) {
  const values = await Promise.all([...LEGACY_TABLES].map(async table => [table, (await sdk.getDocsFromServer(sdk.collection(db, original(table)))).docs.map(row => [row.id, row.data()])]))
  return createHash('sha256').update(JSON.stringify(values)).digest('hex')
}
test('direct SDK owner History callers search exact original ID/customer/phone, page raw records, read stock/payment evidence and combine frozen profit with originals unchanged', async () => {
  await fixture(); const db = owner(), read = client(db), before = await immutableSnapshot(db)
  for (const search of ['QqCHl8BRIn', 'Yu Thandar Win', '09942988167']) {
    const history = await read(`admin/history?search=${encodeURIComponent(search)}`)
    assert.equal(history.total, 1); assert.equal(history.orders[0].id, 'QqCHl8BRInz67ZomN9jY')
    assert.equal(history.orders[0].balanceDue, 34500); assert.equal(history.orders[0]._source.immutable, true)
    assert.equal(history.payments.length, 1)
  }
  const detail = await read('admin/history/orders/QqCHl8BRInz67ZomN9jY')
  assert.equal(detail.original.customer.name, 'Yu Thandar Win'); assert.equal(detail.effective.fulfillmentStatus, 'reserved')
  assert.equal(detail.source.sha256, legacySourceHash({ id: 'QqCHl8BRInz67ZomN9jY', data: () => ({ ...detail.original, id: undefined }) }))
  const posOrders = await read('admin/pos/orders?paged=true&view=summary&search=Yu%20Thandar%20Win')
  assert.equal(posOrders.totalCount, 1)
  assert.equal(posOrders.orders[0].id, 'belle-history:QqCHl8BRInz67ZomN9jY')
  assert.equal(posOrders.orders[0].historyOrderId, 'QqCHl8BRInz67ZomN9jY'); assert.equal(posOrders.orders[0].balanceDue, 34500)
  const first = await read('admin/history/records/catalog?page_size=25')
  assert.equal(first.records.length, 25); assert.equal(first.next_cursor, 'item-24')
  const second = await read(`admin/history/records/catalog?page_size=25&after=${first.next_cursor}`)
  assert.equal(second.records.length, 2); assert.equal(second.records[0].id, 'item-25'); assert.equal(second.next_cursor, null)
  const stock = await read('admin/history/stock')
  assert.equal(stock.authority, false); assert.equal(stock.source, 'legacy-read-only'); assert.equal(stock.evidence.length, 3)
  const report = await read('admin/history/financial')
  assert.deepEqual(report.financial.combined, { revenue: 1500, costOfGoods: 300, grossProfit: 1200, operatingExpenses: 50, netProfit: 1150 })
  assert.equal(report.readOnly, true); assert.equal(report.counts.legacyOrders, 2)
  assert.equal((await read('admin/history/financial?from=2026-07-23&to=2026-07-23')).financial.combined.revenue, 500)
  assert.equal((await read('admin/history/financial?from=2026-10-14&to=2026-10-14')).financial.combined.revenue, 1000)
  assert.equal(await immutableSnapshot(db), before)
})
test('direct history Rules/read adapter deny guest/outsider/source mutations; inactive continuation refuses before original queries and unknown source paths fail', async () => {
  await fixture(); const db = owner(), read = client(db)
  await assertFails(sdk.getDoc(sdk.doc(environment.unauthenticatedContext().firestore(), `${original('orders')}/paid`)))
  await assertFails(sdk.getDoc(sdk.doc(environment.authenticatedContext('outsider').firestore(), `${root}/pos_orders/sale`)))
  await assertFails(sdk.updateDoc(sdk.doc(db, `${original('orders')}/paid`), { total: 1 }))
  let calls = 0
  const counted = { ...sdk, getDocsFromServer: reference => { calls++; return sdk.getDocsFromServer(reference) }, getDocFromServer: reference => { calls++; return sdk.getDocFromServer(reference) } }
  const direct = createDirectHistoryClient({ db, auth: { currentUser: { uid: MAIN_OWNER_UID } }, sdk: counted })
  await assert.rejects(direct('admin/history/orders/paid/events', { action: 'complete', request_key: 'inactive' }), { status: 409 }); assert.equal(calls, 0)
  const denied = createDirectHistoryClient({ db, auth: { currentUser: { uid: 'outsider' } }, sdk: counted })
  await assert.rejects(denied('admin/history'), { status: 403 }); assert.equal(calls, 0)
  const repository = createDirectReadRepository({ db, auth: { currentUser: { uid: MAIN_OWNER_UID } }, sdk })
  assert.throws(() => repository.doc('users/outsider/orders/paid'), { status: 403 })
  assert.throws(() => repository.doc(`${original('orders')}/../paid`), { status: 400 })
  await assert.rejects(repository.runTransaction(tx => tx.set(repository.doc(`${original('orders')}/paid`), { total: 1 })), { status: 403 })
  await assert.rejects(read('admin/history/records/secrets'), { status: 400 })
  await assert.rejects(read('admin/history/financial?from=2026-02-30'), { status: 400 })
})
test('browser SHA-256 evidence equals Node canonical hashing for timestamps, Unicode and exact originals; mismatched overlay source refuses combined reports', async () => {
  for (const value of ['', 'Belle မြန်မာ', JSON.stringify({ quantity: '0.001', paid: false })]) assert.equal(sha256Hex(value), createHash('sha256').update(value).digest('hex'))
  await fixture(); const db = owner(), source = await sdk.getDoc(sdk.doc(db, `${original('orders')}/paid`))
  const canonical = value => value?.toDate ? { timestamp: value.toDate().toISOString() } : value instanceof Date ? { timestamp: value.toISOString() } : Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
  assert.equal(legacySourceHash({ id: source.id, data: () => source.data() }), createHash('sha256').update(JSON.stringify(canonical({ id: source.id, data: source.data() }))).digest('hex'))
  await environment.withSecurityRulesDisabled(async context => {
    await sdk.setDoc(sdk.doc(context.firestore(), `${root}/legacy_heads/paid`), { source_hash: 'wrong', version: 1 })
  })
  await assert.rejects(client(db)('admin/history/financial'), error => error.code === 'HISTORY_RECONCILIATION_REQUIRED' && error.status === 409)
})
test('search reuses original snapshots only after the reviewed immutable-source marker; mutable overlays stay fresh and source-policy removal invalidates reuse', async () => {
  await fixture(); const db = owner(); let originalScans = 0
  const counted = { ...sdk, getDocsFromServer: reference => { if (reference.path?.startsWith(`users/${MAIN_OWNER_UID}/`)) originalScans++; return sdk.getDocsFromServer(reference) } }
  const read = createDirectHistoryClient({ db, auth: { currentUser: { uid: MAIN_OWNER_UID } }, sdk: counted })
  await environment.withSecurityRulesDisabled(async context => {
    await sdk.setDoc(sdk.doc(context.firestore(), `${root}/direct_runtime/main`), { original_policy_version: 'immutable-history-v1', original_records_immutable: true, original_writers_stopped: true })
  })
  await read('admin/history?search=Yu'); assert.equal(originalScans, 3)
  await read('admin/history?search=QqCHl8BRIn'); assert.equal(originalScans, 3)
  await environment.withSecurityRulesDisabled(async context => {
    await sdk.updateDoc(sdk.doc(context.firestore(), `${root}/direct_runtime/main`), { original_records_immutable: false })
  })
  await read('admin/history?search=Yu'); assert.equal(originalScans, 6)
})

async function active() {
  await fixture()
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await sdk.setDoc(sdk.doc(db, `${root}/direct_runtime/main`), { legacy_continuation_enabled: true, original_policy_version: 'immutable-history-v1', original_records_immutable: true, original_writers_stopped: true, backend_writers_stopped: true })
    await sdk.setDoc(sdk.doc(db, `${original('orders')}/another`), order(34500, 12000, { paymentStatus: 'unpaid', amountPaid: 0, balanceDue: 34500 }))
  })
}
const target = 'admin/history/orders/QqCHl8BRInz67ZomN9jY/events'
const receive = (amount, key, transactionId = '000002', method = 'KBZ Pay 1', extra = {}) => ({ action: 'payment', request_key: key, date: '2026-10-14', amount, method, transactionId, note: '', ...extra })
test('direct SDK partial/final payment and completion create immutable overlay chain once, preserve all originals and financial recognition/search identity', async () => {
  await active(); const db = owner(), read = client(db), before = await immutableSnapshot(db)
  assert.equal((await read('admin/history')).continuation_enabled, true)
  const partial = await read(target, receive(1000, 'partial'))
  assert.equal(partial.paymentStatus, 'partial'); assert.equal(partial.amountPaid, 1000); assert.equal(partial.balanceDue, 33500)
  assert.deepEqual(await read(target, receive(1000, 'partial')), partial)
  await assert.rejects(read(target, receive(1001, 'partial')), { status: 409 })
  assert.equal((await read('admin/history/financial')).financial.combined.revenue, 1500)
  const complete = await read(target, { action: 'complete', request_key: 'complete' })
  assert.equal(complete.fulfillmentStatus, 'completed'); assert.equal(complete.version, 2)
  assert.deepEqual(await read(target, { action: 'complete', request_key: 'complete' }), complete)
  const final = await read(target, receive(33500, 'final', '000003'))
  assert.equal(final.paymentStatus, 'paid'); assert.equal(final.version, 3); assert.equal(final.balanceDue, 0)
  const report = await read('admin/history/financial')
  assert.equal(report.financial.combined.revenue, 36000); assert.equal(report.counts.overlayPayments, 2)
  assert.equal(report.financial.legacy.revenue, 35000)
  assert.equal((await read('admin/pos/orders?paged=true&search=Yu')).orders[0].paymentStatus, 'paid')
  const detail = await read('admin/history/orders/QqCHl8BRInz67ZomN9jY')
  assert.equal(detail.events.length, 3); assert.equal(detail.original.paymentStatus, 'unpaid'); assert.equal(detail.effective.paymentStatus, 'paid')
  assert.equal(await immutableSnapshot(db), before)
  const event = detail.events[0], payment = (await sdk.getDocs(sdk.collection(db, `${root}/pos_payments`))).docs.find(row => row.data().source === 'legacy-overlay')
  await assertFails(sdk.updateDoc(sdk.doc(db, `${root}/legacy_events/${event.id}`), { action: 'complete' }))
  await assertFails(sdk.deleteDoc(payment.ref))
  await assertFails(sdk.deleteDoc(sdk.doc(db, `${root}/legacy_direct_sources/QqCHl8BRInz67ZomN9jY`)))
})
test('simultaneous historical payments cannot overpay or reuse a reference across orders; COD retains both unique reference claims', async () => {
  await active(); const db = owner(), read = client(db)
  const outcomes = await Promise.allSettled([read(target, receive(20000, 'one', '000010')), read(target, receive(20000, 'two', '000011'))])
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1, JSON.stringify(outcomes.map(row => row.reason?.message || 'accepted')))
  assert.equal((await read('admin/history/orders/QqCHl8BRInz67ZomN9jY')).effective.amountPaid, 20000)
  const winner = outcomes.find(row => row.status === 'fulfilled').value
  const receipt = (await sdk.getDoc(sdk.doc(db, `${root}/pos_payments/${winner.paymentId}`))).data()
  await assert.rejects(read('admin/history/orders/another/events', receive(100, 'reuse', receipt.transactionId)), { status: 409 })
  await read('admin/history/orders/another/events', receive(100, 'cod', '000020', 'COD', { billNumber: '000030' }))
  assert.equal((await sdk.getDocs(sdk.collection(db, `${root}/pos_payment_references`))).size, 3)
  await assert.rejects(read('admin/history/orders/another/events', receive(100, 'cod-reuse', '000021', 'COD', { billNumber: '000030' })), { status: 409 })
  await assert.rejects(read(target, receive(100, 'old-reference', '000001')), { status: 409 })
})
test('unknown commit response reuses its request identity, while malformed Rules-bound payment/head/date or missing claims roll back without original writes', async () => {
  await active(); const db = owner(); let hidden = false
  const uncertain = { ...sdk, runTransaction: async (db, action) => {
    const result = await sdk.runTransaction(db, action)
    if (!hidden) { hidden = true; throw new Error('Response lost after commit') }
    return result
  } }
  const direct = createDirectHistoryClient({ db, auth: { currentUser: { uid: MAIN_OWNER_UID } }, sdk: uncertain })
  await assert.rejects(direct(target, receive(1000, 'uncertain')), /Response lost/)
  assert.equal((await direct(target, receive(1000, 'uncertain'))).amountPaid, 1000)
  assert.equal((await sdk.getDocs(sdk.collection(db, `${root}/legacy_events`))).size, 1)
  for (const change of ['head', 'amount', 'date', 'missing-claim']) {
    await active()
    const corrupt = { ...sdk, runTransaction: (db, action) => sdk.runTransaction(db, tx => action({ get: reference => tx.get(reference), set: (reference, data) => {
      if (change === 'missing-claim' && reference.path.includes('/pos_payment_references/')) return
      if (change === 'head' && reference.path.includes('/legacy_heads/')) data = { ...data, balanceDue: 0 }
      if (change === 'amount' && reference.path.includes('/pos_payments/')) data = { ...data, amount: 40000 }
      if (change === 'date' && reference.path.includes('/pos_payments/')) data = { ...data, date: '2026-02-30' }
      tx.set(reference, data)
    } })) }
    const read = createDirectHistoryClient({ db, auth: { currentUser: { uid: MAIN_OWNER_UID } }, sdk: corrupt })
    const before = await immutableSnapshot(db)
    await assert.rejects(read(target, receive(1000, 'corrupt')), error => error.code === 'permission-denied')
    assert.equal((await sdk.getDocs(sdk.collection(db, `${root}/legacy_events`))).size, 0)
    assert.equal((await sdk.getDocs(sdk.collection(db, `${root}/pos_payments`))).size, 0)
    assert.equal(await immutableSnapshot(db), before)
  }
})
test('source-paid/preorder records remain read-only, source drift rejects continuation and a valid zero-total reserved order can still complete without a receipt', async () => {
  await active(); const db = owner(), read = client(db)
  await assert.rejects(read('admin/history/orders/paid/events', { action: 'complete', request_key: 'paid-no-write' }), { status: 409 })
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore(), batch = sdk.writeBatch(db)
    batch.set(sdk.doc(db, `${original('orders')}/preorder`), order(100, 10, { fulfillmentStatus: 'preorder', paymentStatus: 'unpaid', amountPaid: 0, balanceDue: 100 }))
    batch.set(sdk.doc(db, `${original('orders')}/zero`), order(0, 0, { paymentStatus: 'unpaid', amountPaid: 0, balanceDue: 0 }))
    await batch.commit()
  })
  await assert.rejects(read('admin/history/orders/preorder/events', receive(100, 'preorder-no-write')), { status: 409 })
  const before = await immutableSnapshot(db)
  const zero = await read('admin/history/orders/zero/events', { action: 'complete', request_key: 'zero' })
  assert.equal(zero.fulfillmentStatus, 'completed'); assert.equal(zero.amountPaid, 0)
  assert.equal((await sdk.getDocs(sdk.collection(db, `${root}/pos_payments`))).size, 0)
  assert.equal(await immutableSnapshot(db), before)
  await read(target, receive(1000, 'source-check'))
  await environment.withSecurityRulesDisabled(async context => {
    await sdk.updateDoc(sdk.doc(context.firestore(), `${original('orders')}/QqCHl8BRInz67ZomN9jY`), { remark: 'Simulated forbidden external source drift' })
  })
  await assert.rejects(read(target, receive(1000, 'source-changed', '000003')), { status: 409 })
  assert.equal((await sdk.getDocs(sdk.collection(db, `${root}/pos_payments`))).size, 1)
})
test('sealed original reference evidence makes Rules reject reuse of a pre-index receipt even when a tampered client hides the original payment query', async () => {
  await active(); const db = owner(), read = client(db)
  await read(target, receive(1000, 'baseline'))
  const baselineRef = sdk.doc(db, `${root}/legacy_reference_baseline/main`), baseline = (await sdk.getDoc(baselineRef)).data()
  assert.equal(baseline.keys['kbz-pay-1__000001'], true)
  const hidden = { ...sdk, getDocsFromServer: async reference => {
    const snapshot = await sdk.getDocsFromServer(reference)
    return reference.path === `${original('payments')}` ? { docs: [], size: 0, empty: true } : snapshot
  } }
  const tampered = createDirectHistoryClient({ db, auth: { currentUser: { uid: MAIN_OWNER_UID } }, sdk: hidden })
  await assert.rejects(tampered('admin/history/orders/another/events', receive(100, 'hidden-original', '000001')), error => error.code === 'permission-denied')
  assert.equal((await sdk.getDocs(sdk.collection(db, `${root}/pos_payments`))).size, 1)
  await assertFails(sdk.updateDoc(baselineRef, { keys: {} }))
})
