import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { createDirectReportsClient } from '../../BelleLocal POS app/src/features/firebase-direct/reports-client.js'
import { MAIN_OWNER_UID } from '../../BelleLocal POS app/src/features/firebase-direct/content-model.js'
import { legacySourceHash } from '../../BelleLocal POS app/src/shared/pos-domain/history.js'
import { digest } from '../../BelleLocal POS app/src/shared/pos-domain/mutation.js'
import { saleRecordsCsv } from '../../BelleLocal POS app/src/features/retails/lib/saleRecordExport.js'
import { getVariantKey } from '../../BelleLocal POS app/src/shared/pos-domain/legacy/variant.js'
import { directStockScope } from '../../BelleLocal POS app/src/features/firebase-direct/availability-model.js'
const require = createRequire(new URL('../../BelleLocal POS app/package.json', import.meta.url)), sdk = require('firebase/firestore')
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing')
if (process.env.DIRECT_FIRESTORE_EMULATOR !== '127.0.0.1:8088') throw Error('Use the isolated direct emulator.')
const environment = await initializeTestEnvironment({ projectId: 'demo-belle-direct-reports', firestore: { host: '127.0.0.1', port: 8088, rules: await readFile(new URL('../../BelleLocal POS app/config/firebase/firestore.direct.rules', import.meta.url), 'utf8') } })
test.after(() => environment.cleanup())
const root = 'onlineShopV2/belle-online', original = table => `users/${MAIN_OWNER_UID}/${table}`, at = '2026-10-14T03:00:00.000Z'
const owner = () => environment.authenticatedContext(MAIN_OWNER_UID).firestore()
const read = db => createDirectReportsClient({ db, auth: { currentUser: { uid: MAIN_OWNER_UID, displayName: 'Demo owner' } }, sdk, now: () => Date.parse(at) })
const range = '?from=2026-07-01&to=2026-10-14'
const oldOrder = (price, cost, fields = {}) => ({ date: '2026-07-23', total: price, amountPaid: price, balanceDue: 0, paymentStatus: 'paid', fulfillmentStatus: 'reserved', customer: { name: 'Original buyer' }, items: [{ id: 'original-line', quantity: 1, unitPrice: price, unitCost: cost, type: 'Elegence', color: 'Brown', size: 'Size 1' }], ...fields })
async function fixture({ opening = false } = {}) {
  await environment.clearFirestore()
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore(), batch = sdk.writeBatch(db)
    batch.set(sdk.doc(db, `${original('orders')}/old-paid`), oldOrder(500, 100))
    batch.set(sdk.doc(db, `${original('orders')}/old-unpaid`), oldOrder(34500, 12000, { paymentStatus: 'unpaid', amountPaid: 0, balanceDue: 34500 }))
    batch.set(sdk.doc(db, `${original('payments')}/same`), { orderId: 'old-paid', amount: 500, date: '2026-07-23', method: 'KBZ Pay 1', transactionId: '000001', actor_uid: MAIN_OWNER_UID })
    batch.set(sdk.doc(db, `${original('stocks')}/old-batch`), { quantity: 2, type: 'Elegence', color: 'Brown', size: 'Size 1', date: '2026-07-01', price: 100 })
    batch.set(sdk.doc(db, `${root}/store_settings/main`), { store_name: 'Belle demo' })
    batch.set(sdk.doc(db, `${root}/pos_categories/retail`), { id: 'retail', name: 'Retail' })
    batch.set(sdk.doc(db, `${root}/pos_products/product`), { id: 'product', name: 'Current dress', categoryId: 'retail', isActive: true, cost: 99999 })
    batch.set(sdk.doc(db, `${root}/pos_orders/sale`), { id: 'sale', orderNumber: '00001', saleType: 'IN_STORE', subtotal: 1000, discount: 0, total: 1000, paymentStatus: 'paid', fulfillmentStatus: 'completed', createdAt: at, completedAt: at,
      items: [{ id: 'line', productId: 'product', quantity: 1, baseQuantity: '1', unitCost: 200, lineTotal: 1000, recognizedAt: at }] })
    batch.set(sdk.doc(db, `${root}/pos_payments/same`), { id: 'same', orderId: 'sale', type: 'payment', scope: 'order-payment', amount: 1000, method: 'Cash', paidAt: at })
    batch.set(sdk.doc(db, `${root}/pos_payments/refund`), { id: 'refund', orderId: 'sale', originalPaymentId: 'same', type: 'refund', scope: 'financial-refund', amount: -200, method: 'Wallet', paidAt: at })
    batch.set(sdk.doc(db, `${root}/pos_audit/actor`), { id: 'actor', entity: 'Payment', entityId: 'same', actorId: MAIN_OWNER_UID, action: 'payment.create', createdAt: at })
    await batch.commit()
    if (opening) {
      const snapshots = await Promise.all(['stocks', 'orders'].map(table => sdk.getDocs(sdk.collection(db, original(table)))))
      const evidence = snapshots.flatMap(value => value.docs.map(doc => ({ path: doc.ref.path, sha256: legacySourceHash({ id: doc.id, data: () => doc.data() }) }))).sort((a,b) => a.path.localeCompare(b.path))
      const hash = digest(evidence), mappings = [{ legacy_variant_key: getVariantKey('Size 1', 'Brown', 'Elegence'), pos_product_id: 'product', pos_variant_id: null }]
      const claim = { owner_uid: MAIN_OWNER_UID, shop_id: 'belle-online', source_snapshot_hash: hash }
      await sdk.setDoc(sdk.doc(db, `${root}/legacy_stock_baselines/main`), { status: 'ACTIVE', writer_policy: 'immutable-history-v1', owner_uid: MAIN_OWNER_UID, source_snapshot_hash: hash, mappings, payload_hash: digest({ ownerUid: MAIN_OWNER_UID, input: { expected_snapshot_hash: hash, mappings } }) })
      await sdk.setDoc(sdk.doc(db, `onlineShopV2/_legacy_sources/source_claims/${digest(MAIN_OWNER_UID)}`), claim)
    }
  })
}
async function snapshot(db) {
  const tables = ['orders','payments','stocks']
  const originals = await Promise.all(tables.map(async table => [table, (await sdk.getDocsFromServer(sdk.collection(db, original(table)))).docs.map(row => [row.id,row.data()])]))
  const current = await Promise.all(['pos_orders','pos_payments','legacy_stock_baselines'].map(async table => [table, (await sdk.getDocsFromServer(sdk.collection(db, `${root}/${table}`))).docs.map(row => [row.id,row.data()])]))
  return digest([originals,current])
}
test('mounted report paths use SDK reads, retain original/current recognition and frozen COGS/refunds once, preserve Sale Records CSV identities and old/current payment collisions', async () => {
  await fixture({ opening: true }); const db = owner(), reports = read(db), before = await snapshot(db)
  const sales = await reports('admin/pos/reports/sales' + range)
  assert.equal(sales.summary.totalSales.current, 1500); assert.equal(sales.summary.totalCostPrice.current, 300); assert.equal(sales.summary.grossProfit.current, 1000)
  assert.equal(sales.collectionTotal, 1300)
  assert.deepEqual(new Set(sales.saleRecords.map(row => row.key)), new Set(['legacy:old-paid','retails:sale']))
  assert.equal(sales.saleRecords.find(row => row.source === 'belle-history').href, '#/history?order=old-paid')
  assert.ok(saleRecordsCsv(sales.saleRecords).includes('"belle-history"')); assert.ok(saleRecordsCsv(sales.saleRecords).includes('"retails"'))
  const payments = await reports('admin/pos/reports/payments' + range)
  assert.equal(payments.summary.collected, 1500); assert.equal(payments.summary.refunds, 200); assert.equal(payments.summary.netCollected, 1300)
  assert.equal(payments.summary.outstanding, 34700)
  assert.equal(new Set(payments.recent.map(row => row.id)).size, 3)
  assert.ok(payments.recent.some(row => row.sourceKind === 'belle-history' && row.datePrecision === 'day'))
  assert.equal(payments.recent.find(row => row.id === 'same').actor.name, 'Demo owner')
  assert.equal(await snapshot(db), before)
})
test('source date/method filters and cursor pagination keep stable totals with no original receipt time or user-name invention', async () => {
  await fixture(); const db = owner(), reports = read(db)
  const historical = await reports('admin/pos/reports/sales?from=2026-07-23&to=2026-07-23&payment=KBZ%20Pay%201')
  assert.equal(historical.summary.totalSales.current, 500); assert.equal(historical.summary.totalCostPrice.current, 100)
  const first = await reports('admin/pos/reports/payments' + range + '&pageSize=1')
  assert.equal(first.recent.length, 1); assert.equal(first.pagination.hasMore, true)
  const second = await reports('admin/pos/reports/payments' + range + '&pageSize=1&cursor=' + first.pagination.nextCursor)
  assert.deepEqual(second.summary, first.summary); assert.notEqual(second.recent[0].id, first.recent[0].id)
  const old = await reports('admin/pos/reports/payments' + range + '&method=KBZ%20Pay%201&staffId=' + MAIN_OWNER_UID)
  assert.equal(old.summary.collected, 500); assert.equal(old.recent[0].paidAt, '2026-07-23'); assert.equal(old.recent[0].datePrecision, 'day')
  assert.equal(old.staff.find(row => row.id === MAIN_OWNER_UID).name, 'Demo owner')
})
test('Rules isolate opening claims and private reports; owner mismatch/unsupported mutation reject before reads and damaged source opening/product linkage reports reconciliation', async () => {
  await fixture({ opening: true }); const db = owner(), reports = read(db)
  await assertFails(sdk.getDoc(sdk.doc(environment.unauthenticatedContext().firestore(), `onlineShopV2/_legacy_sources/source_claims/${digest(MAIN_OWNER_UID)}`)))
  await assertFails(sdk.getDoc(sdk.doc(environment.authenticatedContext('outsider').firestore(), `${root}/pos_payments/same`)))
  await assertFails(sdk.setDoc(sdk.doc(db, `onlineShopV2/_legacy_sources/source_claims/${digest('another-owner')}`), { owner_uid: MAIN_OWNER_UID }))
  await assert.rejects(reports('admin/pos/reports/payments?branchId=another-shop'), { status: 403 })
  await assert.rejects(reports('admin/pos/reports/sales', { total: 1 }), { status: 403 })
  const outsider = createDirectReportsClient({ db, auth: { currentUser: { uid: 'outsider' } }, sdk })
  await assert.rejects(outsider('admin/pos/reports/sales'), { status: 403 })
  await environment.withSecurityRulesDisabled(async context => { await sdk.updateDoc(sdk.doc(context.firestore(), `${root}/legacy_stock_baselines/main`), { source_snapshot_hash: 'wrong' }) })
  await assert.rejects(reports('admin/pos/reports/sales' + range), { status: 409 })
  await fixture()
  await environment.withSecurityRulesDisabled(async context => { await sdk.deleteDoc(sdk.doc(context.firestore(), `${root}/pos_products/product`)) })
  await assert.rejects(read(db)('admin/pos/reports/sales' + range), { status: 409 })
})
test('owner Home uses shared financial/source-rights calculations, resolves original opening without another grant and reports both current and historical sales read-only', async () => {
  await fixture({ opening: true }); const db = owner()
  const scope = await directStockScope('product')
  await environment.withSecurityRulesDisabled(async context => {
    await sdk.setDoc(sdk.doc(context.firestore(), `${root}/stock_balances/${scope}`), { productId: 'product', onHand: '4', reserved: '1', version: 1 })
  })
  const before = await snapshot(db), home = await read(db)('admin/pos/dashboard?from=2026-07-01&to=2026-10-14')
  assert.equal(home.summary.revenue, 1300)
  assert.equal(home.summary.costOfGoods, 300)
  assert.equal(home.summary.grossProfit, 1000)
  assert.equal(home.summary.stockUnits, 6)
  assert.equal(home.sourceReport.financial.legacy.revenue, 500)
  assert.ok(home.recentSales.some(row => row.source === 'belle-history' && row.historyHref === '#/history?order=old-paid'))
  assert.ok(home.recentSales.some(row => row.source === 'retails' && row.sourceOrderId === 'sale'))
  assert.equal((await sdk.getDoc(sdk.doc(db, `${root}/stock_balances/${scope}`))).data().onHand, '4')
  assert.equal(await snapshot(db), before)
})
test('unresolved/system audit actors keep source fallback attribution and filters without introducing browser Auth administration', async () => {
  await fixture(); const db = owner()
  await environment.withSecurityRulesDisabled(async context => {
    await sdk.updateDoc(sdk.doc(context.firestore(), `${root}/pos_audit/actor`), { actorId: 'system:maintenance' })
  })
  const payment = await read(db)('admin/pos/reports/payments' + range + '&staffId=system%3Amaintenance')
  assert.equal(payment.summary.collected, 1000)
  assert.equal(payment.recent.find(row => row.id === 'same').actor.name, 'Staff')
  assert.equal(payment.recent.find(row => row.id === 'same').actor.id, 'system:maintenance')
})
