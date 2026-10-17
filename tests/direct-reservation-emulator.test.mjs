import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { MAIN_OWNER_UID } from '../../BelleLocal POS app/src/features/firebase-direct/content-model.js'
import { directStockScope } from '../../BelleLocal POS app/src/features/firebase-direct/availability-model.js'
import { createDirectReservationRepository } from '../../BelleLocal POS app/src/features/firebase-direct/reservation-repository.js'
const require = createRequire(new URL('../../BelleLocal POS app/package.json', import.meta.url)), sdk = require('firebase/firestore')
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing')
if (process.env.DIRECT_FIRESTORE_EMULATOR !== '127.0.0.1:8088') throw Error('Use the explicitly isolated direct emulator.')
const env = await initializeTestEnvironment({ projectId: 'demo-belle-direct-reservation', firestore: { host: '127.0.0.1', port: 8088, rules: await readFile(new URL('../../BelleLocal POS app/config/firebase/firestore.direct.rules', import.meta.url), 'utf8') } })
test.after(() => env.cleanup())
const root = 'onlineShopV2/belle-online', scope = await directStockScope('pos', 'v'), fixedTime = Date.parse('2026-10-14T00:00:00.000Z')
const owner = () => env.authenticatedContext(MAIN_OWNER_UID).firestore(), ref = (db, table, id) => sdk.doc(db, `${root}/${table}/${id}`)
const repo = db => createDirectReservationRepository({ db, auth: { currentUser: { uid: MAIN_OWNER_UID } }, sdk, now: () => fixedTime })
const body = (sourceId, quantity = '1', action = 'reserve') => ({ productId: 'pos', variantId: 'v', sourceType: 'Order', sourceId, quantity, action })
const original = { paymentStatus: 'unpaid', total: 34500, items: [{ name: 'Original dress', quantity: 1 }] }
const originalHash = createHash('sha256').update(JSON.stringify(original)).digest('hex')
async function fixture({ enabled = true, ledger = true, lots = false } = {}) {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore(), batch = sdk.writeBatch(db)
    batch.set(ref(db, 'direct_runtime', 'main'), { stock_authority: 'ledger-v2', backend_writers_stopped: enabled, original_writers_stopped: true })
    batch.set(ref(db, 'pos_settings', 'main'), { ledgerEnabled: ledger })
    batch.set(ref(db, 'pos_products', 'pos'), { id: 'pos', trackingMode: lots ? 'LOT' : 'NONE', variants: [{ id: 'v', price: 34500 }] })
    batch.set(ref(db, 'stock_balances', scope), { productId: 'pos', variantId: 'v', onHand: '2', reserved: '0', version: 1 })
    for (const [index, id] of ['old', 'new'].entries()) {
      batch.set(ref(db, 'stock_batches', id), { id, productId: 'pos', variantId: 'v', scopeKey: scope, baseQuantity: '1', quantity: 1, reservedBaseQuantity: '0', reservedQuantity: 0, physicalBaseQuantity: '1', heldBaseQuantity: '0', consumedBaseQuantity: '0', unitCost: 12000 + index * 1000, receivedAt: `2026-10-${12 + index}`, ...(index === 0 ? { legacySource: { fifoDate: '2026-07-23', batchId: 'original' } } : {}) })
      if (lots) batch.set(ref(db, 'pos_inventory_lots', `lot-${id}`), { id: `lot-${id}`, productId: 'pos', inventoryBatchId: id, status: 'ACTIVE', quantity: '1', expiresAt: index ? '2026-11-01' : '2026-12-01', receivedAt: '2026-10-12' })
    }
    batch.set(ref(db, 'stock_bindings', 'choice'), { id: 'choice', public_variant_id: 'choice', public_product_id: 'post', pos_product_id: 'pos', pos_variant_id: 'v', scope_key: scope })
    batch.set(ref(db, 'products', 'post'), { id: 'post', status: 'published', variants: [{ id: 'choice', active: true }] })
    batch.set(sdk.doc(db, `users/${MAIN_OWNER_UID}/orders/original`), original)
    await batch.commit()
  })
}
test('SDK/Rules reservation rejects 3 against 2, retains FIFO costs, retries once, consumes once and preserves original and disabled source ledger', async () => {
  await fixture({ ledger: false })
  const db = owner(), service = repo(db)
  await assert.rejects(service.reservation(body('oversell', '3'), 'too-many'), { status: 409 })
  assert.equal((await sdk.getDocs(sdk.collection(db, `${root}/stock_requests`))).size, 0)
  const result = await service.reservation(body('one', '1.5'), 'reserve-one')
  assert.deepEqual(result.allocations.map(row => [row.inventoryBatchId, row.baseQuantity, row.cost]), [['old', '1', '12000'], ['new', '0.5', '6500']])
  assert.equal(result.totalCost, '18500')
  assert.deepEqual(await service.reservation(body('one', '1.5'), 'reserve-one'), result)
  await assert.rejects(service.reservation(body('one', '1'), 'reserve-one'), { status: 409 })
  assert.equal((await sdk.getDoc(ref(db, 'stock_balances', scope))).data().reserved, '1.5')
  assert.equal((await sdk.getDoc(ref(db, 'public_stock', 'choice'))).data().available, 0)
  const consumed = await service.reservation(body('one', '0', 'consume'), 'consume-one')
  assert.equal(consumed.status, 'CONSUMED'); assert.equal(consumed.totalCost, '18500')
  assert.deepEqual(await service.reservation(body('one', '0', 'consume'), 'consume-one'), consumed)
  await assert.rejects(service.reservation(body('one', '0', 'consume'), 'consume-again'), { status: 409 })
  const balance = (await sdk.getDoc(ref(db, 'stock_balances', scope))).data()
  assert.equal(balance.onHand, '0.5'); assert.equal(balance.reserved, '0')
  assert.deepEqual(balance.sourceLedger, { onHand: '2', reserved: '0', version: 1 })
  assert.equal((await sdk.getDocs(sdk.collection(db, `${root}/stock_movements`))).size, 2)
  const untouched = (await sdk.getDoc(sdk.doc(db, `users/${MAIN_OWNER_UID}/orders/original`))).data()
  assert.equal(createHash('sha256').update(JSON.stringify(untouched)).digest('hex'), originalHash)
  const publicDb = env.unauthenticatedContext().firestore()
  assert.equal((await sdk.getDoc(ref(publicDb, 'public_stock', 'choice'))).data().available, 0)
  await assertFails(sdk.getDoc(ref(publicDb, 'stock_reservations', result.id)))
  await assertFails(sdk.updateDoc(ref(publicDb, 'stock_balances', scope), { reserved: '0' }))
  await assertFails(sdk.updateDoc(sdk.doc(db, `users/${MAIN_OWNER_UID}/orders/original`), { paymentStatus: 'paid' }))
  await assertFails(sdk.updateDoc(ref(db, 'stock_requests', (await sdk.getDocs(sdk.collection(db, `${root}/stock_requests`))).docs[0].id), { operation: 'changed' }))
})
test('three simultaneous SDK reservations share stock fence, accept only two, release exactly once and do not manufacture quantity', async () => {
  await fixture(); const db = owner(), service = repo(db)
  const outcomes = await Promise.allSettled(['a', 'b', 'c'].map(id => service.reservation(body(id), `reserve-${id}`)))
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 2, JSON.stringify(outcomes.map(row => row.status === 'fulfilled' ? { status: row.status } : { status: row.status, message: row.reason.message, code: row.reason.code })))
  assert.equal(outcomes.filter(row => row.status === 'rejected' && row.reason.status === 409).length, 1)
  let balance = (await sdk.getDoc(ref(db, 'stock_balances', scope))).data()
  assert.equal(balance.onHand, '2'); assert.equal(balance.reserved, '2')
  const saved = outcomes.find(row => row.status === 'fulfilled').value
  await service.reservation(body(saved.sourceId, '0', 'release'), 'release-one')
  await service.reservation(body(saved.sourceId, '0', 'release'), 'release-one')
  await assert.rejects(service.reservation(body(saved.sourceId, '0', 'release'), 'release-other'), { status: 409 })
  balance = (await sdk.getDoc(ref(db, 'stock_balances', scope))).data()
  assert.equal(balance.onHand, '2'); assert.equal(balance.reserved, '1')
  assert.equal((await sdk.getDoc(ref(db, 'public_stock', 'choice'))).data().available, 1)
  assert.equal((await sdk.getDocs(sdk.collection(db, `${root}/stock_requests`))).size, 3)
})
test('Rules reject unfenced owner writes and runtime cutover refusal avoids scans; LOT consume writes FEFO identity and immutable sale evidence', async () => {
  await fixture({ enabled: false }); const db = owner(); let scans = 0
  const counted = { ...sdk, getDocsFromServer: ref => { scans++; return sdk.getDocsFromServer(ref) } }
  const service = createDirectReservationRepository({ db, auth: { currentUser: { uid: MAIN_OWNER_UID } }, sdk: counted })
  await assert.rejects(service.reservation(body('not-ready'), 'not-ready'), { status: 409 }); assert.equal(scans, 0)
  await fixture({ lots: true })
  await assertFails(sdk.updateDoc(ref(db, 'stock_balances', scope), { reserved: '1' }))
  const direct = repo(db), result = await direct.reservation(body('lot-order'), 'lot-order')
  assert.equal(result.allocations[0].inventoryBatchId, 'new')
  await direct.reservation(body('lot-order', '0', 'consume'), 'lot-consume')
  assert.equal((await sdk.getDoc(ref(db, 'pos_inventory_lots', 'lot-new'))).data().status, 'DEPLETED')
  const movements = (await sdk.getDocs(sdk.collection(db, `${root}/stock_movements`))).docs.map(row => row.data())
  assert.equal(movements.length, 1); assert.equal(movements[0].lotId, 'lot-new')
  await assertFails(sdk.updateDoc(ref(db, 'stock_movements', movements[0].id), { unitCost: 0 }))
})
test('SDK transfers a frozen online hold to invoice identity once without releasing/re-reserving or reducing stock twice', async () => {
  await fixture(); const db = owner(), service = repo(db)
  const request = { ...body('guest-one', '1.5'), sourceType: 'OnlineOrder' }
  const held = await service.reservation(request, 'guest-one')
  const batchBefore = (await sdk.getDocs(sdk.collection(db, `${root}/stock_batches`))).docs.map(row => row.data())
  const command = { productId: 'pos', variantId: 'v', quantity: '1.5', fromType: 'OnlineOrder', fromId: 'guest-one', toType: 'Order', toId: 'invoice-one' }
  const invoice = await service.transfer(command, 'handover-one')
  assert.equal(invoice.originReservationId, held.id)
  assert.deepEqual(invoice.allocations, held.allocations); assert.equal(invoice.totalCost, held.totalCost)
  assert.deepEqual(await service.transfer(command, 'handover-one'), invoice)
  await assert.rejects(service.transfer({ ...command, toId: 'another-invoice' }, 'handover-two'), { status: 409 })
  await assert.rejects(service.reservation({ ...request, action: 'release', quantity: '0' }, 'guest-release'), { status: 409 })
  assert.deepEqual((await sdk.getDocs(sdk.collection(db, `${root}/stock_batches`))).docs.map(row => row.data()), batchBefore)
  assert.equal((await sdk.getDoc(ref(db, 'stock_balances', scope))).data().reserved, '1.5')
  assert.equal((await sdk.getDoc(ref(db, 'stock_balances', scope))).data().onHand, '2')
  assert.equal((await sdk.getDoc(ref(db, 'stock_reservations', held.id))).data().status, 'TRANSFERRED')
  await service.reservation(body('invoice-one', '0', 'consume'), 'invoice-consume')
  assert.equal((await sdk.getDoc(ref(db, 'stock_balances', scope))).data().onHand, '0.5')
  assert.equal((await sdk.getDoc(ref(db, 'stock_balances', scope))).data().reserved, '0')
  assert.equal((await sdk.getDocs(sdk.collection(db, `${root}/stock_movements`))).size, 2)
})
test('Rules independently validate exact decimal stock and compatibility counters even with a valid owner/fence; one milli-unit over-reservation rejects at aggregate maximum', async () => {
  await fixture(); const db = owner()
  const attempt = async (table, id, data) => {
    const version = (await sdk.getDoc(ref(db, 'direct_stock_meta', 'main'))).data()?.version || 0
    const batch = sdk.writeBatch(db)
    batch.set(ref(db, 'direct_stock_meta', 'main'), { version: version + 1 })
    batch.update(ref(db, table, id), data)
    return batch.commit()
  }
  for (const patch of [{ onHand: '-1' }, { reserved: '3', version: 2 }, { onHand: '2.0001', version: 2 }, { onHand: '1e2', version: 2 }]) await assertFails(attempt('stock_balances', scope, patch))
  for (const patch of [{ physicalBaseQuantity: '2' }, { reservedBaseQuantity: '0.5', heldBaseQuantity: '0.5', reservedQuantity: 0 }, { physicalBaseQuantity: '-1' }]) await assertFails(attempt('stock_batches', 'old', patch))
  await attempt('stock_batches', 'old', { reservedBaseQuantity: '0.001', heldBaseQuantity: '0.001', reservedQuantity: 0 })
  assert.equal((await sdk.getDoc(ref(db, 'stock_batches', 'old'))).data().heldBaseQuantity, '0.001')
  await env.withSecurityRulesDisabled(async context => {
    await sdk.updateDoc(ref(context.firestore(), 'stock_balances', scope), { onHand: '999999999999999.999', reserved: '999999999999999.998' })
  })
  await assertFails(attempt('stock_balances', scope, { reserved: '1000000000000000', version: 2 }))
  await attempt('stock_balances', scope, { reserved: '999999999999999.999', version: 2 })
  assert.equal((await sdk.getDoc(ref(db, 'stock_balances', scope))).data().reserved, '999999999999999.999')
})
