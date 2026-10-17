import {createPosOrders} from '../../BelleLocal POS app/functions/src/pos/orders.js'
import {createPosOperations} from '../../BelleLocal POS app/functions/src/pos/operations.js'
import {signatureFixture} from './handover-signature-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID, randomInt } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createPublicGuard } from '../../BelleLocal POS app/functions/src/online-shop/abuse.js'
import { createShopApi } from '../../BelleLocal POS app/functions/src/online-shop/api.js'
import { createMaintenanceService } from '../../BelleLocal POS app/functions/src/online-shop/maintenance.js'
import { createImageService } from '../../BelleLocal POS app/functions/src/online-shop/images.js'
import { createHistoryService } from '../../BelleLocal POS app/functions/src/pos/history.js'
import { createStockLedger, stockScopeKey } from '../../BelleLocal POS app/functions/src/pos/stock-ledger.js'
import { createPosTaxonomy } from '../../BelleLocal POS app/functions/src/pos/taxonomy.js'
import { createPosCatalog } from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import { createOrderService } from '../../BelleLocal POS app/functions/src/online-shop/orders.js'
import { createShopStock } from '../../BelleLocal POS app/functions/src/online-shop/stock.js'
import { normalizeProduct, publicProduct } from '../../BelleLocal POS app/functions/src/online-shop/domain.js'
const require = createRequire(new URL('../../BelleLocal POS app/functions/package.json', import.meta.url))
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || process.env.STORAGE_EMULATOR_HOST !== 'http://127.0.0.1:9199') throw Error('Tests require isolated local Auth/Firestore/Storage emulators (Storage uses an http URL).')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')
const { getStorage } = require('firebase-admin/storage')
initializeApp({ projectId: 'demo-belle-online' })
const db = getFirestore(); const auth = getAuth()
const base = 'http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/'
const password = 'Local-test-only-123!'
test('bound public checkout and POS ledger share atomic multi-line reservations, rollback, private stock and terminal lifecycle', async () => {
  const shop = 'bound-' + randomUUID(); const path = `onlineShopV2/${shop}`
  const table = (name) => db.collection(`${path}/${name}`); const ledger = createStockLedger({ db })
  const stock = createShopStock({ db }); const orders = createOrderService({ db, checkoutEnabled: true })
  const product = normalizeProduct({ name: 'Bound dress', slug: 'bound-dress', status: 'published', variants: ['brown','black'].map((color) => ({ color, size: '1', sku: color, price: 34500, active: true })) }, null, shop)
  await table('products').doc(product.id).set(product)
  for (const variant of product.variants) await table('pos_products').doc(variant.color).set({ name: 'POS ' + variant.color, isActive: true, trackingMode: 'NONE' })
  for (const variant of product.variants) {
    await ledger.receive(shop, { productId: variant.color, quantity: 2, unitCost: 20000 }, 'demo-owner', randomUUID())
    const binding = { public_product_id: product.id, public_variant_id: variant.id, pos_product_id: variant.color }
    const first = await stock.bind(shop, binding, 'demo-owner')
    assert.deepEqual(await stock.bind(shop, binding, 'demo-owner'), first)
    await assert.rejects(stock.bind(shop, { ...binding, pos_product_id: variant.color === 'brown' ? 'black' : 'brown' }, 'demo-owner'), { status: 409 })
  }
  const body = (lines = product.variants.map((variant) => ({ variant_id: variant.id, quantity: 1 }))) => ({ request_key: randomUUID(), tracking_token: 'f'.repeat(64), customer: { name: 'Bound buyer', phone: '09942988167', city: 'Yangon', address: 'Private bound address' }, items: lines })
  // Force failure in the second scope so a successful first plan is never
  // committed when a later line cannot obtain stock.
  const lastScope = [...product.variants].sort((a,b) => stockScopeKey(a.color).localeCompare(stockScopeKey(b.color))).at(-1)
  const rejected = body(product.variants.map((variant) => ({ variant_id: variant.id, quantity: variant.id === lastScope.id ? 3 : 1 })))
  await assert.rejects(orders.checkout(shop, rejected), { status: 409, orderRejected: true })
  assert.equal((await table('orders').get()).size, 0); assert.equal((await table('stock_reservations').get()).size, 0)
  assert.equal((await table('stock_requests').where('operation', '==', 'reserve').get()).size, 0)
  const request = body(); const accepted = await orders.checkout(shop, request)
  assert.deepEqual(await orders.checkout(shop, request), accepted)
  const saved = (await table('orders').doc(request.request_key).get()).data()
  assert.equal(saved.stock_reservations.length, 2); assert.equal(saved.ledger_variant_ids.length, 2)
  assert.equal(saved.stock_reservations.reduce((sum, value) => sum + Number(value.totalCost), 0), 40000)
  assert.deepEqual((await table('products').doc(product.id).get()).data(), product)
  const projected = await stock.project(shop, [product]); assert.equal(projected[0].variants[0].available, 1)
  const publicValue = publicProduct(projected[0], [], [])
  assert.equal(publicValue.variants[0].available, 1)
  for (const field of ['stock_scope_key','scope_key','stock_authority','pos_product_id','totalCost']) assert.equal(JSON.stringify(publicValue).includes(field), false)
  const brown = product.variants.find((value) => value.color === 'brown')
  const competing = await Promise.allSettled([
    orders.checkout(shop, body([{ variant_id: brown.id, quantity: 1 }])),
    ledger.reservation(shop, { productId: 'brown', sourceType: 'PosOrder', sourceId: 'concurrent', quantity: 1 }, 'demo-owner', randomUUID()),
  ])
  assert.equal(competing.filter((value) => value.status === 'fulfilled').length, 1)
  assert.equal(competing.find((value) => value.status === 'rejected').reason.status, 409)
  const tracked = await orders.track(shop, accepted)
  assert.equal(tracked.total, 69000); assert.equal(tracked.stock_reservations, undefined); assert.equal(JSON.stringify(tracked).includes('20000'), false)
  await orders.transition(shop,request.request_key,{status:'confirmed'},'demo-owner')
  await assert.rejects(orders.transition(shop,request.request_key,{status:'packing'},'demo-owner'),/Create its POS invoice/)
  const pos=createPosOrders({db}),operations=createPosOperations({db,getCreatorName:async()=> 'Demo owner'}),invoice=(await pos.handover(shop,request.request_key,{paymentMode:'COD'},'demo-owner',randomUUID())).order
  await operations.advance(shop,invoice.id,'start','demo-owner');for(const item of invoice.items)await operations.setPrepared(shop,invoice.id,item.id,{prepared:true},'demo-owner');await operations.advance(shop,invoice.id,'ready','demo-owner')
  await operations.createDelivery(shop,{orderIds:[invoice.id],receiverName:'Courier',receiverPhone:'0999',signatureDataUrl:signatureFixture(),verifiedItems:invoice.items.map((item)=>({orderItemId:item.id,quantity:String(Number(item.enteredQuantity)),unit:item.pricingSnapshot.unitSymbol??''}))},'demo-owner',randomUUID())
  for(const status of ['delivered','delivered'])await orders.transition(shop,request.request_key,{status},'demo-owner')
  assert.equal((await table('stock_movements').where('direction', '==', 'OUT').get()).size, 2)
  const black = product.variants.find((value) => value.color === 'black')
  const cancelled = body([{ variant_id: black.id, quantity: 1 }]); await orders.checkout(shop, cancelled)
  await orders.transition(shop, cancelled.request_key, { status: 'cancelled' }, 'demo-owner')
  await orders.transition(shop, cancelled.request_key, { status: 'cancelled' }, 'demo-owner')
  assert.equal((await stock.project(shop, [product]))[0].variants.find((value) => value.id === black.id).available, 1)
  const expiryRequest = body([{ variant_id: black.id, quantity: 1 }]); await orders.checkout(shop, expiryRequest)
  await table('orders').doc(expiryRequest.request_key).update({ expires_at: new Date(Date.now() - 1000).toISOString() })
  assert.equal((await orders.expire(shop, 'system:maintenance')).expired, 1)
  assert.equal((await stock.project(shop, [product]))[0].variants.find((value) => value.id === black.id).available, 1)
  const broken = body([{ variant_id: black.id, quantity: 1 }]); await orders.checkout(shop, broken)
  await table('orders').doc(broken.request_key).update({ stock_reservations: [] })
  await assert.rejects(orders.transition(shop, broken.request_key, { status: 'cancelled' }, 'demo-owner'), { status: 409 })
  assert.equal((await table('orders').doc(broken.request_key).get()).data().status, 'pending')
})
test('catalogue aliases aggregate one POS hold; fractional availability and mixed-stock rollback remain exact', async () => {
  const shop='aliases-'+randomUUID(); const table=(name)=>db.collection(`onlineShopV2/${shop}/${name}`)
  const ledger=createStockLedger({db}); const stock=createShopStock({db}); const orders=createOrderService({db,checkoutEnabled:true})
  await table('pos_products').doc('shared').set({name:'Shared SKU',isActive:true})
  await ledger.receive(shop,{productId:'shared',quantity:'2.5',unitCost:1000},'demo-owner',randomUUID())
  const product=normalizeProduct({name:'Two public names',slug:'aliases',status:'published',variants:['brown','black'].map((color)=>({color,size:'1',sku:color,price:5000,active:true}))},null,shop)
  const staged=normalizeProduct({name:'Unbound staged',slug:'staged',status:'published',variants:[{color:'White',size:'1',sku:'staged',price:100,active:true}]},null,shop)
  staged.variants[0].on_hand=1
  await table('products').doc(product.id).set(product); await table('products').doc(staged.id).set(staged)
  for (const variant of product.variants) await stock.bind(shop,{public_product_id:product.id,public_variant_id:variant.id,pos_product_id:'shared'},'demo-owner')
  const available=publicProduct((await stock.project(shop,[product]))[0],[],[])
  assert.deepEqual(available.variants.map((variant)=>variant.available),[2,2])
  const body=(items)=>({request_key:randomUUID(),tracking_token:'a'.repeat(64),customer:{name:'Alias buyer',phone:'09942988167',city:'Yangon',address:'Address'},items})
  await assert.rejects(orders.checkout(shop,body(product.variants.map((variant)=>({variant_id:variant.id,quantity:variant.color==='brown'?2:1})))),{status:409})
  // The ledger plan succeeds first; the staged line then rejects the entire
  // transaction. Neither representation may retain the earlier reservation.
  await assert.rejects(orders.checkout(shop,body([{variant_id:product.variants[0].id,quantity:1},{variant_id:staged.variants[0].id,quantity:2}])),{status:409})
  assert.equal((await table('stock_reservations').get()).size,0)
  assert.equal((await table('orders').get()).size,0)
  assert.deepEqual((await table('products').doc(staged.id).get()).data(),staged)
  const request=body([...product.variants.map((variant)=>({variant_id:variant.id,quantity:1})),{variant_id:staged.variants[0].id,quantity:1}])
  await orders.checkout(shop,request)
  const order=(await table('orders').doc(request.request_key).get()).data()
  assert.equal(order.stock_reservations.length,1); assert.equal(order.stock_reservations[0].quantity,'2')
  assert.equal(order.stock_reservations[0].totalCost,'2000'); assert.equal(order.ledger_variant_ids.length,2)
  assert.equal((await table('stock_reservations').get()).size,1)
  assert.deepEqual(publicProduct((await stock.project(shop,[product]))[0],[],[]).variants.map((variant)=>variant.available),[0,0])
  await orders.transition(shop,request.request_key,{status:'cancelled'},'demo-owner')
  await orders.transition(shop,request.request_key,{status:'cancelled'},'demo-owner')
  const balance=(await table('stock_balances').get()).docs[0].data()
  assert.equal(balance.onHand,'2.5'); assert.equal(balance.reserved,'0')
  assert.deepEqual((await table('products').doc(product.id).get()).data(),product)
  assert.deepEqual((await table('products').doc(staged.id).get()).data().variants,staged.variants)
})

test('exact Firebase stock ledger: FIFO costs, competing POS/public holds, resizing, one-time consumption and immutable history', async () => {
  const shop = 'ledger-' + randomUUID(); const ledger = createStockLedger({ db })
  const root = db.doc(`onlineShopV2/${shop}`); const scoped = (table) => db.collection(`${root.path}/${table}`)
  const legacyRef = db.doc('users/demo-owner/stocks/ledger-legacy-' + randomUUID())
  const legacy = { type: 'Existing dress', quantity: 9, unitCost: 5000, date: '2026-07-23' }
  await legacyRef.set(legacy)
  await scoped('pos_products').doc('dress').set({ name: 'Ledger dress', variants: [{ id: 'brown' }], trackingMode: 'NONE' })
  const scope = { productId: 'dress', variantId: 'brown' }
  const receipt = { ...scope, quantity: '0.6', unitCost: 100, receivedAt: '2026-07-01T00:00:00Z' }
  const receiptKey = randomUUID(); const first = await ledger.receive(shop, receipt, 'demo-owner', receiptKey)
  assert.deepEqual(await ledger.receive(shop, receipt, 'demo-owner', receiptKey), first)
  await assert.rejects(ledger.receive(shop, { ...receipt, quantity: '0.7' }, 'demo-owner', receiptKey), { status: 409 })
  const second = await ledger.receive(shop, { ...scope, quantity: '0.7', unitCost: 200, receivedAt: '2026-07-02T00:00:00Z' }, 'demo-owner', randomUUID())
  assert.equal(second.averageCost, 154)
  await assert.rejects(ledger.receive(shop, { ...receipt, unitId: 'carton' }, 'demo-owner', randomUUID()), { status: 400 })
  const hold = { ...scope, sourceType: 'OnlineOrder', sourceId: 'buyer', quantity: '0.8' }
  const holdKey = randomUUID(); const held = await ledger.reservation(shop, hold, 'demo-owner', holdKey)
  assert.deepEqual(held.allocations.map((row) => [row.inventoryBatchId, row.baseQuantity]), [[first.inventoryBatch.id, '0.6'], [second.inventoryBatch.id, '0.2']])
  assert.equal(held.totalCost, '100')
  assert.deepEqual(await ledger.reservation(shop, hold, 'demo-owner', holdKey), held)
  const parallel = await Promise.allSettled(['pos-1', 'pos-2'].map((sourceId) => ledger.reservation(shop, { ...scope, sourceType: 'PosOrder', sourceId, quantity: '0.4' }, 'demo-owner', randomUUID())))
  assert.equal(parallel.filter((row) => row.status === 'fulfilled').length, 1)
  const stockConflict = parallel.find((row) => row.status === 'rejected').reason
  assert.equal(stockConflict.status, 409, stockConflict.stack)
  const loser = parallel.findIndex((row) => row.status === 'rejected') + 1
  assert.equal((await scoped('stock_reservations').where('sourceId', '==', `pos-${loser}`).get()).size, 0)
  const consume = { ...scope, sourceType: 'OnlineOrder', sourceId: 'buyer', action: 'consume' }; const consumeKey = randomUUID()
  const [sold, concurrentReplay] = await Promise.all([ledger.reservation(shop, consume, 'demo-owner', consumeKey), ledger.reservation(shop, consume, 'demo-owner', consumeKey)])
  assert.deepEqual(concurrentReplay, sold)
  assert.equal(sold.status, 'CONSUMED'); assert.equal(sold.totalCost, '100')
  assert.deepEqual(await ledger.reservation(shop, consume, 'demo-owner', consumeKey), sold)
  await assert.rejects(ledger.reservation(shop, consume, 'demo-owner', randomUUID()), { status: 409 })
  const winner = parallel.findIndex((row) => row.status === 'fulfilled') + 1
  const resize = { ...scope, sourceType: 'PosOrder', sourceId: `pos-${winner}`, quantity: '0.3' }
  await ledger.reservation(shop, resize, 'demo-owner', randomUUID())
  const balance = (await scoped('stock_balances').get()).docs[0]
  assert.equal(balance.data().onHand, '0.5'); assert.equal(balance.data().reserved, '0.3')
  await scoped('pos_products').doc('dress').update({ isActive: false })
  await assert.rejects(ledger.receive(shop, receipt, 'demo-owner', randomUUID()), { status: 400 })
  await assert.rejects(ledger.reservation(shop, { ...resize, sourceId: 'archived-new' }, 'demo-owner', randomUUID()), { status: 400 })
  const released = await ledger.reservation(shop, { ...resize, quantity: 0, action: 'release' }, 'demo-owner', randomUUID())
  assert.equal(released.status, 'RELEASED')
  assert.equal((await balance.ref.get()).data().reserved, '0')
  assert.equal((await scoped('stock_movements').where('direction', '==', 'OUT').get()).size, 2)
  const finalBatches = (await scoped('stock_batches').get()).docs.map((doc) => doc.data())
  assert.equal(finalBatches.reduce((sum, row) => sum + Number(row.physicalBaseQuantity), 0), 0.5)
  assert.equal(finalBatches.find((row) => row.id === first.inventoryBatch.id).baseQuantity, '0.6')
  assert.equal(finalBatches.find((row) => row.id === first.inventoryBatch.id).reservedBaseQuantity, '0.6')
  assert.equal(finalBatches.find((row) => row.id === second.inventoryBatch.id).baseQuantity, '0.7')
  assert.equal(finalBatches.find((row) => row.id === second.inventoryBatch.id).reservedBaseQuantity, '0.2')
  assert.deepEqual((await legacyRef.get()).data(), legacy)
  // Corruption/drift must fail closed rather than silently fixing historic or new balances.
  await scoped('pos_products').doc('dress').update({ isActive: true })
  const subsequent = await ledger.receive(shop, { ...scope, quantity: '0.1', unitCost: 300 }, 'demo-owner', randomUUID())
  assert.equal(subsequent.averageCost, 164)
  await balance.ref.update({ onHand: '99' })
  const movementsBefore = (await scoped('stock_movements').get()).size
  await assert.rejects(ledger.receive(shop, receipt, 'demo-owner', randomUUID()), { status: 409 })
  assert.equal((await scoped('stock_movements').get()).size, movementsBefore)
  await scoped('pos_products').doc('bulk').set({ name: 'Bulk stock', isActive: true })
  for (let i = 0; i < 2; i++) await ledger.receive(shop, { productId: 'bulk', quantity: '2000000000', unitCost: 100 }, 'demo-owner', randomUUID())
  const bulkBalance = (await scoped('stock_balances').where('productId', '==', 'bulk').get()).docs[0].data()
  assert.equal(bulkBalance.onHand, '4000000000')
})
test('POS checkout ledger plans consume grouped FIFO allocations once and roll back late rejection', async () => {
  const shop = 'checkout-ledger-' + randomUUID(), ledger = createStockLedger({ db })
  const scoped = (table) => db.collection(`onlineShopV2/${shop}/${table}`)
  await scoped('pos_products').doc('dress').set({ name: 'Checkout dress', isActive: true })
  const first = await ledger.receive(shop, { productId: 'dress', quantity: '2', unitCost: 100, receivedAt: '2026-07-01T00:00:00Z' }, 'demo-owner', randomUUID())
  const second = await ledger.receive(shop, { productId: 'dress', quantity: '2', unitCost: 200, receivedAt: '2026-07-02T00:00:00Z' }, 'demo-owner', randomUUID())
  const input = { productId: 'dress', sourceType: 'PosOrder', sourceId: 'checkout', quantity: '3' }
  const key = randomUUID()
  const saleAllocations = [
    { id: 'item-one-first', inventoryBatchId: first.inventoryBatch.id, baseQuantity: '1.5', unitCost: 100 },
    { id: 'item-two-first', inventoryBatchId: first.inventoryBatch.id, baseQuantity: '0.5', unitCost: 100 },
    { id: 'item-two-second', inventoryBatchId: second.inventoryBatch.id, baseQuantity: '1', unitCost: 200 },
  ]
  const complete = () => db.runTransaction(async (tx) => {
    const plan = await ledger.prepareReservation(tx, shop, input, 'demo-owner', key, { consumeImmediately: true, saleAllocations })
    plan.apply(); return plan.result
  })
  // A failure after scheduling writes still rolls back every stock document.
  await assert.rejects(db.runTransaction(async (tx) => {
    const plan = await ledger.prepareReservation(tx, shop, input, 'demo-owner', key, { consumeImmediately: true, saleAllocations })
    plan.apply(); throw Object.assign(new Error('Later order line rejected'), { status: 409 })
  }), { status: 409 })
  const balance = (await scoped('stock_balances').get()).docs[0]
  assert.equal(balance.data().onHand, '4'); assert.equal(balance.data().reserved, '0')
  assert.equal((await scoped('stock_reservations').get()).size, 0)
  await assert.rejects(db.runTransaction(async (tx) => {
    const plan = await ledger.prepareReservation(tx, shop, input, 'demo-owner', key, { consumeImmediately: true, saleAllocations: [{ ...saleAllocations[0], unitCost: 999 }] })
    plan.apply()
  }), { status: 409 })
  const result = await complete()
  assert.equal(result.status, 'CONSUMED'); assert.equal(result.totalCost, '400')
  assert.deepEqual(await complete(), result)
  assert.equal((await balance.ref.get()).data().onHand, '1'); assert.equal((await balance.ref.get()).data().reserved, '0')
  const movements = (await scoped('stock_movements').where('direction', '==', 'OUT').get()).docs.map((row) => row.data())
  assert.equal(movements.length, 3)
  assert.deepEqual(movements.map((row) => row.sourceId).sort(), saleAllocations.map((row) => row.id).sort())
  assert.ok(movements.every((row) => row.sourceType === 'OrderItemAllocation' && row.idempotencyKey === 'sale:' + row.sourceId))
  // Aggregate holds can span multiple individually valid Int32 batches.
  await scoped('pos_products').doc('bulk').set({ name: 'Bulk checkout', isActive: true })
  for (let i = 0; i < 2; i++) await ledger.receive(shop, { productId: 'bulk', quantity: '2000000000', unitCost: 1 }, 'demo-owner', randomUUID())
  await assert.rejects(db.runTransaction(async tx => {
    const plan = await ledger.prepareReservation(tx, shop, { productId:'bulk',sourceType:'PosOrder',sourceId:'oversized-item',quantity:'4000000000' }, 'demo-owner', randomUUID(), { allocationRequests:[{id:'oversized-item',quantity:'4000000000'}] })
    plan.apply()
  }), { status:400 })
  assert.equal((await scoped('stock_balances').where('productId','==','bulk').get()).docs[0].data().reserved,'0')
  const bulk = await ledger.reservation(shop, { productId: 'bulk', sourceType: 'PosOrder', sourceId: 'bulk-order', quantity: '4000000000' }, 'demo-owner', randomUUID())
  assert.equal(bulk.quantity, '4000000000'); assert.equal(bulk.allocations.length, 2)
  const released = await ledger.reservation(shop, { productId: 'bulk', sourceType: 'PosOrder', sourceId: 'bulk-order', action: 'release' }, 'demo-owner', randomUUID())
  assert.equal(released.status, 'RELEASED')
})

test('legacy stock evidence uses original Belle reservation rules and one read-only snapshot', async () => {
  const ownerUid = 'baseline-' + randomUUID(); const shop = 'baseline-' + randomUUID()
  const service = createHistoryService({ db, ownerUid }); const path = `users/${ownerUid}`
  const stocks = db.collection(path + '/stocks'); const orders = db.collection(path + '/orders')
  const variant = { type: 'Dress', size: '1', color: 'Brown' }
  const originalStocks = [ { id: 'a', ...variant, quantity: 3, unitCost: 100, date: '2026-07-01' }, { id: 'b', ...variant, quantity: 2, unitCost: 200, date: '2026-07-02' } ]
  for (const value of originalStocks) await stocks.doc(value.id).set(value)
  const allocated = { id: 'allocated', fulfillmentStatus: 'completed', paymentStatus: 'paid', date: '2026-07-03', items: [{ id: 'line', ...variant, quantity: 1, allocations: [{ stockBatchId: 'a', quantity: 1, unitCost: 100 }] }] }
  const fallback = { id: 'fallback', fulfillmentStatus: 'reserved', paymentStatus: 'unpaid', date: '2026-07-03', items: [{ id: 'line', ...variant, quantity: 2 }] }
  await orders.doc('allocated').set(allocated); await orders.doc('fallback').set(fallback)
  await orders.doc('cancelled').set({ ...fallback, id: 'cancelled', fulfillmentStatus: 'cancelled' })
  const first = await service.stock()
  assert.equal(first.authority, false); assert.equal(first.source, 'legacy-read-only')
  assert.equal(first.availableByVariant['1__Brown__Dress'], 2)
  assert.equal(first.reservedByBatch.a, 3); assert.equal(first.stocks.find((row) => row.id === 'b').availableQuantity, 2)
  assert.deepEqual(first.anomalies, []); assert.equal(first.evidence.length, 5)
  assert.equal((await service.stock()).snapshotHash, first.snapshotHash)
  await orders.doc('oversold').set({ ...fallback, id: 'oversold', items: [{ id: 'extra', ...variant, quantity: 3 }] })
  const oversold = await service.stock()
  assert.equal(oversold.availableByVariant['1__Brown__Dress'], 0)
  assert.ok(oversold.anomalies.some((row) => row.type === 'over-reserved-variant' && row.shortage === 1))
  assert.notEqual(oversold.snapshotHash, first.snapshotHash)
  for (const value of originalStocks) assert.deepEqual((await stocks.doc(value.id).get()).data(), value)
  assert.deepEqual((await orders.doc('allocated').get()).data(), allocated)
  assert.deepEqual((await orders.doc('fallback').get()).data(), fallback)
  assert.equal((await db.doc(`onlineShopV2/${shop}`).listCollections()).length, 0)
})
test('emulator rules allow legacy owner reads, reject legacy edits and deny direct online namespace access', async () => {
  const posRequire = createRequire(new URL('../../BelleLocal POS app/package.json', import.meta.url))
  const { initializeTestEnvironment, assertSucceeds, assertFails } = posRequire('@firebase/rules-unit-testing')
  const { doc, getDoc, setDoc } = posRequire('firebase/firestore')
  const rules = await readFile(new URL('../../BelleLocal POS app/online-shop.emulator.rules', import.meta.url), 'utf8')
  const environment = await initializeTestEnvironment({ projectId:'demo-belle-online', firestore:{host:'127.0.0.1',port:8080,rules} })
  try {
    const ownerDb = environment.authenticatedContext('demo-owner').firestore()
    const otherDb = environment.authenticatedContext('outsider').firestore()
    await assertSucceeds(getDoc(doc(ownerDb,'users/demo-owner/orders/legacy-sale')))
    await assertFails(setDoc(doc(ownerDb,'users/demo-owner/orders/legacy-sale'),{total:0}))
    await assertFails(getDoc(doc(otherDb,'users/demo-owner/orders/legacy-sale')))
    await assertFails(getDoc(doc(ownerDb,'onlineShopV2/belle-online/products/direct')))
    await assertFails(setDoc(doc(ownerDb,'onlineShopV2/belle-online/products/direct'),{name:'Bypass'}))
  } finally { await environment.cleanup() }
})
async function token(uid, email) {
  try { await auth.createUser({ uid, email, password }) } catch (e) { if (e.code !== 'auth/uid-already-exists' && e.code !== 'auth/email-already-exists') throw e }
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true}) })
  assert.equal(response.status,200); return (await response.json()).idToken
}
async function api(path, body, token, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
  return { status:response.status, data:response.status === 204 ? null : response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text() }
}
test('Retails categories/units use Firebase HTTP contracts, name locks and transaction-history deletion guards', async () => {
  const owner = await token('demo-owner','owner@belle-demo.example')
  const outsider = await token('demo-other','other@belle-demo.example')
  assert.equal((await api('admin/pos/categories')).status,401)
  assert.equal((await api('admin/pos/units',undefined,outsider)).status,403)
  const name='Category '+randomUUID()
  const created=await api('admin/pos/categories',{name},owner)
  assert.equal(created.status,201); assert.equal(created.data.category.name,name)
  const categoryId=created.data.category.id
  assert.equal((await api('admin/pos/categories',{name},owner)).status,409)
  const renamed=name+' renamed'
  assert.equal((await api('admin/pos/categories/'+categoryId,{name:renamed},owner,'PATCH')).data.category.name,renamed)
  assert.ok((await api('admin/pos/categories',undefined,owner)).data.categories.some((row)=>row.id===categoryId && row._count.products===0))
  assert.equal((await api('admin/pos/categories/'+categoryId,undefined,owner,'DELETE')).status,204)
  assert.equal((await api('admin/pos/categories/'+categoryId,undefined,owner,'DELETE')).status,404)
  const unitName='Unit '+randomUUID()
  const unitResult=await api('admin/pos/units',{name:unitName,symbol:'pc',precision:3},owner)
  assert.equal(unitResult.status,201)
  const reused=await api('admin/pos/units',{name:unitName.toLowerCase(),symbol:'changed',precision:0},owner)
  assert.deepEqual(reused.data.unit,unitResult.data.unit)
  assert.equal((await api('admin/pos/units',{name:'Invalid',precision:'3'},owner)).status,400)
  assert.equal((await api('admin/pos/units',null,owner)).status,400)
  assert.equal((await api('admin/pos/categories',null,owner)).status,400)
  assert.equal((await api('admin/pos/units/'+unitResult.data.unit.id,undefined,owner,'DELETE')).status,204)
  const orders=await api('admin/pos/orders',undefined,owner)
  assert.equal(orders.status,200)
  assert.ok(Array.isArray(orders.data.orders))

  const service=createPosTaxonomy({db}); const shop='taxonomy-'+randomUUID()
  const table=(name)=>db.collection(`onlineShopV2/${shop}/${name}`)
  const duplicate=await Promise.allSettled([1,2].map(()=>service.category(shop,'POST',null,{name:'Dresses'},'demo-owner')))
  assert.equal(duplicate.filter((entry)=>entry.status==='fulfilled').length,1)
  const categoryConflict=duplicate.find((entry)=>entry.status==='rejected').reason
  assert.equal(categoryConflict.status,409,categoryConflict.stack)
  const category=duplicate.find((entry)=>entry.status==='fulfilled').value
  await table('pos_products').doc('archived-product').set({categoryId:category.id,isActive:false})
  assert.equal((await service.listCategories(shop)).categories[0]._count.products,1)
  await assert.rejects(service.category(shop,'DELETE',category.id,{},'demo-owner'),{status:409})
  const units=await Promise.all([service.createUnit(shop,{name:'Carton',precision:3},'demo-owner'),service.createUnit(shop,{name:'carton',precision:0},'demo-owner')])
  assert.deepEqual(units[0],units[1]); assert.equal((await table('pos_units').get()).size,1)
  for (let round=0;round<4;round++) {
    const values=await Promise.all(['Pack','pack','PACK'].map((name)=>service.createUnit(shop,{name:name+round},'demo-owner')))
    assert.deepEqual(values[0],values[1]); assert.deepEqual(values[1],values[2])
  }
  const unitId=units[0].id
  const evidence=[['pos_products',{units:[{unitId}],isActive:false}],['stock_movements',{unitId}],['stock_batches',{unitSnapshot:{unitId}}],['pos_orders',{items:[{unitId}]}],['pos_purchases',{items:[{unitId}]}]]
  for (const [name,value] of evidence) {
    const ref=table(name).doc('used-unit'); await ref.set(value)
    assert.equal((await service.listUnits(shop)).units.find((unit)=>unit.id===unitId).canRemove,false)
    await assert.rejects(service.removeUnit(shop,unitId,'demo-owner'),{status:400})
    assert.deepEqual((await ref.get()).data(),value); await ref.delete()
  }
  assert.equal((await service.listUnits(shop)).units.find((unit)=>unit.id===unitId).canRemove,true)
  await service.removeUnit(shop,unitId,'demo-owner')
  await assert.rejects(service.removeUnit(shop,unitId,'demo-owner'),{status:404})
  await table('pos_units').doc('first').set({name:'Pack'})
  await table('pos_units').doc('second').set({name:'pack'})
  await assert.rejects(service.createUnit(shop,{name:'PACK'},'demo-owner'),{status:409})
  assert.equal((await service.createUnit(shop,{name:'Pack'},'demo-owner')).id,'first')
  await table('pos_settings').doc('main').set({capabilities:{'catalog.units':false}})
  await assert.rejects(service.createUnit(shop,{name:'Blocked'},'demo-owner'),{status:403})
  const audits=(await table('pos_audit').get()).docs.map((doc)=>doc.data())
  assert.ok(audits.some((entry)=>entry.action==='unit.delete' && entry.actorId==='demo-owner'))
  assert.ok(audits.some((entry)=>entry.action==='category.create'))
})
test('Retails Product/Stock In creates atomic units, barcodes, opening stock, weighted cost, expenses and immutable request evidence',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example');const outsider=await token('demo-other','other@belle-demo.example')
  const posApi=async(path,body,key,method=body===undefined?'GET':'POST',bearer=owner)=>{
    const response=await fetch(base+'admin/pos/'+path,{method,headers:{'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{}),...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
    return {status:response.status,data:response.status===204?null:await response.json()}
  }
  assert.equal((await posApi('products',undefined,null,'GET',null)).status,401)
  assert.equal((await posApi('inventory',undefined,null,'GET',outsider)).status,403)
  const label='HTTP Product '+randomUUID();const key=randomUUID()
  const input={name:label,sku:'SKU-'+randomUUID(),price:5000,cost:3000,units:[{name:'Piece',conversionFactor:1,isBase:true}],quantityPrecision:3,openingStock:{quantity:2.5,unitCost:3000,supplierName:'Opening supplier',invoiceReference:'OPEN-'+key}}
  const first=await posApi('products',input,key);assert.equal(first.status,201);assert.equal(first.data.product.cost,3000)
  assert.deepEqual((await posApi('products',input,key)).data,first.data)
  assert.equal((await posApi('products',{...input,name:'Changed'},key)).status,409)
  const productId=first.data.product.id
  const detail=await posApi('products/'+productId);assert.equal(detail.status,200)
  assert.equal(detail.data.product.currentStock,2.5);assert.equal(detail.data.product.availableStock,2.5)
  assert.equal(detail.data.product.baseUnitLocked,true);assert.equal(detail.data.product.units[0].canEdit,false)
  const receipt={productId,quantity:1.5,unitCost:4000,deliveryCost:500,deliveryMethod:'Cash',supplierName:'Stock supplier',invoiceReference:'REC-'+key,receivedAt:'2026-10-11T06:00:00Z'}
  const receiptKey=randomUUID();const received=await posApi('inventory',receipt,receiptKey)
  assert.equal(received.status,201);assert.deepEqual((await posApi('inventory',receipt,receiptKey)).data,received.data)
  assert.equal((await posApi('inventory',{...receipt,quantity:1.6},receiptKey)).status,409)
  const updated=(await posApi('products/'+productId)).data.product
  assert.equal(updated.currentStock,4);assert.equal(updated.cost,3375)
  const expense=await db.collection('onlineShopV2/belle-online/pos_expenses').where('note','==',`Auto-recorded from inventory batch ${received.data.inventoryBatch.id}.`).get()
  assert.equal(expense.size,1);assert.equal(expense.docs[0].data().amount,500)
  const searched=(await posApi('products?search='+encodeURIComponent(input.sku)+'&pageSize=25&view=catalog')).data
  assert.equal(searched.totalCount,1);assert.equal(searched.products[0].cost,undefined)
  assert.equal((await posApi('products?pageSize=26')).status,400)
  const sources=(await posApi('products/'+productId+'/source-history')).data.sources
  assert.equal(sources.length,2);assert.ok(sources.some((batch)=>batch.supplierName==='Stock supplier'))
  const costs=(await posApi('products/'+productId+'/cost-history')).data.history
  assert.equal(costs.length,2);assert.ok(costs.some((entry)=>entry.averageCost===3375))
  assert.equal((await posApi('products/'+productId,{cost:3500},randomUUID(),'PATCH')).status,501)

  const shop='products-'+randomUUID();const table=(name)=>db.collection(`onlineShopV2/${shop}/${name}`)
  const catalog=createPosCatalog({db});const ledger=createStockLedger({db})
  const payload={name:'Atomic dress',price:200,cost:100,units:[{name:'Piece',conversionFactor:1,isBase:true},{name:'Carton',conversionFactor:12,isBase:false}],barcode:{value:'5901234123457',kind:'MANUFACTURER',symbology:'EAN13'},shortCode:'AB1234',openingStock:{quantity:2.5,unitCost:100,receivedAt:'2026-10-01T18:00:00Z'}}
  const legacyRef=db.doc('users/demo-owner/orders/product-legacy-'+randomUUID());const original={total:34500,paymentStatus:'unpaid',fulfillmentStatus:'reserved',auditMarker:'immutable'};await legacyRef.set(original)
  const created=await catalog.create(shop,payload,'demo-owner',randomUUID())
  assert.equal(created.units.length,2);assert.equal(created.barcodes.length,1)
  const loaded=(await catalog.get(shop,created.id)).product
  assert.equal(loaded.barcodes.length,2);assert.equal(loaded.barcodes.find((barcode)=>barcode.isPrimary).id,created.barcodes[0].id)
  assert.equal(loaded.units[0].isUsed,true);assert.equal(loaded.units[1].canEdit,true)
  assert.equal(loaded.units[1].canRemove,true)
  const beforeCounts=Object.fromEntries(await Promise.all(['pos_products','pos_units','pos_barcodes','stock_batches','stock_movements','pos_audit'].map(async(name)=>[name,(await table(name).get()).size])))
  await assert.rejects(catalog.create(shop,{...payload,name:'Bad duplicate barcode',units:[{name:'Uncommitted unit',conversionFactor:1,isBase:true}]},'demo-owner',randomUUID()),{status:409})
  await assert.rejects(catalog.create(shop,{name:'No base',price:100,cost:50,openingStock:{quantity:1,unitCost:50}},'demo-owner',randomUUID()),{status:400})
  await assert.rejects(catalog.create(shop,{...payload,name:'Bad factor',units:[{name:'Uncommitted factor',conversionFactor:2,isBase:true}]},'demo-owner',randomUUID()),{status:400})
  for(const [name,count] of Object.entries(beforeCounts))assert.equal((await table(name).get()).size,count)
  for(let round=0;round<4;round++){
    const competing=await Promise.allSettled(['First','Second','Third'].map((name)=>catalog.create(shop,{name,price:100,cost:50,barcode:{value:'CD135'+round,kind:'INTERNAL'}},'demo-owner',randomUUID())))
    assert.equal(competing.filter((entry)=>entry.status==='fulfilled').length,1)
    for(const {reason} of competing.filter((entry)=>entry.status==='rejected'))assert.equal(reason.status,409,reason.stack)
  }
  await table('pos_products').doc(created.id).update({variants:[{id:'brown'},{id:'black'}]})
  await ledger.receive(shop,{productId:created.id,variantId:'brown',quantity:1,unitCost:200},'demo-owner',randomUUID())
  await ledger.receive(shop,{productId:created.id,variantId:'black',quantity:1,unitCost:400},'demo-owner',randomUUID())
  assert.equal((await table('pos_products').doc(created.id).get()).data().cost,189)
  const hold=await ledger.reservation(shop,{productId:created.id,sourceType:'PosOrder',sourceId:'held',quantity:1},'demo-owner',randomUUID())
  const groups=(await catalog.history(shop,created.id,'cost-groups')).groups
  assert.equal(groups.find((group)=>group.id===hold.allocations[0].inventoryBatchId).remainingQuantity,2.5)
  const movements=await catalog.movements(shop,{paged:'true',productId:created.id,from:'2026-10-02',to:'2026-10-02'})
  assert.equal(movements.movements.length,1);assert.equal(movements.movements[0].occurredAt,'2026-10-01T18:00:00.000Z')
  assert.equal(movements.pagination.hasMore,false)
  await assert.rejects(catalog.movements(shop,{paged:'true',from:'2026-02-30'}),{status:400})
  assert.deepEqual((await legacyRef.get()).data(),original)
})
test('Retails Product edits preserve stable units, usage locks, sale permissions, version conflicts and immutable source evidence',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example')
  const http=async(path,method,body,key)=>{
    const response=await fetch(base+'admin/pos/'+path,{method,headers:{Authorization:'Bearer '+owner,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
    return {status:response.status,data:await response.json()}
  }
  const created=await http('products','POST',{name:'Edit '+randomUUID(),price:100,cost:50,units:[{name:'Piece',conversionFactor:1,isBase:true}]},randomUUID())
  assert.equal(created.status,201)
  const product=created.data.product;const baseUnit=product.units[0];const requestKey=randomUUID()
  const body={name:'Edited '+product.name,expectedVersion:1,units:[{id:baseUnit.id,unitId:baseUnit.unitId,conversionFactor:1,isBase:true},{name:'Carton '+randomUUID(),conversionFactor:6,isBase:false,canSell:false,canPurchase:true}]}
  assert.equal((await http('products/'+product.id,'PATCH',{...body,expectedVersion:undefined},randomUUID())).status,400)
  assert.equal((await http('products/'+product.id,'PATCH',{stockQuantity:5},randomUUID())).status,400)
  const saved=await http('products/'+product.id,'PATCH',body,requestKey)
  assert.equal(saved.status,200);assert.equal(saved.data.product.version,2);assert.equal(saved.data.product.units[0].id,baseUnit.id)
  const carton=saved.data.product.units[1];assert.equal(carton.canSell,true);assert.equal(carton.canPurchase,false)
  assert.deepEqual((await http('products/'+product.id,'PATCH',body,requestKey)).data,saved.data)
  assert.equal((await http('products/'+product.id,'PATCH',{...body,name:'Changed request'},requestKey)).status,409)
  assert.equal((await http('products/'+product.id,'PATCH',body,randomUUID())).status,409)
  const disabled=await http('products/'+product.id+'/units/'+carton.id,'PATCH',{canSell:false,expectedVersion:2})
  assert.equal(disabled.status,200);assert.equal(disabled.data.unit.canSell,false)
  assert.equal((await http('products/'+product.id+'/units/'+baseUnit.id,'PATCH',{canSell:false,expectedVersion:3})).status,400)
  const receipt=await http('inventory','POST',{productId:product.id,quantity:2.5,unitCost:50,supplierName:'Before',invoiceReference:'Before ref'},randomUUID())
  assert.equal(receipt.status,201)
  const batchId=receipt.data.inventoryBatch.id
  const source=await http('inventory/'+batchId,'PATCH',{supplierName:'After',invoiceReference:'After ref'})
  assert.equal(source.status,200);assert.equal(source.data.inventoryBatch.quantity,3);assert.equal(source.data.inventoryBatch.baseQuantity,'2.5')
  const detail=(await http('products/'+product.id,'GET')).data.product
  assert.equal(detail.version,3);assert.equal(detail.baseUnitLocked,true);assert.equal(detail.units[1].canSell,false)
  const openingMovement=(await db.doc('onlineShopV2/belle-online/stock_movements/'+batchId).get()).data()
  assert.equal(openingMovement.unitSnapshot.productUnitId,baseUnit.id)
  const lockedBody={expectedVersion:3,units:[{id:baseUnit.id,name:'Replacement base '+randomUUID(),conversionFactor:1,isBase:true},{id:carton.id,unitId:carton.unitId,conversionFactor:6,isBase:false}]}
  assert.equal((await http('products/'+product.id,'PATCH',lockedBody,randomUUID())).status,409)
  const allowed=await http('products/'+product.id,'PATCH',{name:'Metadata after Stock In',expectedVersion:3,units:[{id:baseUnit.id,unitId:baseUnit.unitId,conversionFactor:1,isBase:true},{id:carton.id,unitId:carton.unitId,conversionFactor:12,isBase:false}]},randomUUID())
  assert.equal(allowed.status,200);assert.equal(allowed.data.product.units[1].conversionFactor,'12');assert.equal(allowed.data.product.units[1].canSell,false)

  const shop='edit-'+randomUUID();const scoped=(table)=>db.collection(`onlineShopV2/${shop}/${table}`)
  const catalog=createPosCatalog({db});const ledger=createStockLedger({db})
  const local=await catalog.create(shop,{name:'Used conversion',price:200,cost:100,units:[{name:'Piece',conversionFactor:1,isBase:true},{name:'Box',conversionFactor:3,isBase:false}],openingStock:{quantity:2.5,unitCost:100}},'demo-owner',randomUUID())
  const unitPayload=local.units.map((unit)=>({id:unit.id,unitId:unit.unitId,conversionFactor:Number(unit.conversionFactor),isBase:unit.isBase}))
  const extra=local.units[1];const evidence=scoped('pos_orders').doc('order-unit-evidence')
  const order={id:'order-unit-evidence',items:[{productId:local.id,unitId:extra.unitId,pricingSnapshot:{productUnitId:extra.id}}]};await evidence.set(order)
  assert.equal((await catalog.get(shop,local.id)).product.units[1].isUsed,true)
  await assert.rejects(catalog.update(shop,local.id,{expectedVersion:1,units:[unitPayload[0],{...unitPayload[1],conversionFactor:4}]},'demo-owner',randomUUID()),{status:409})
  await assert.rejects(catalog.update(shop,local.id,{expectedVersion:1,units:[unitPayload[0]]},'demo-owner',randomUUID()),{status:409})
  await catalog.sellingUnit(shop,local.id,extra.id,{expectedVersion:1,canSell:false},'demo-owner')
  assert.deepEqual((await evidence.get()).data(),order)
  await evidence.delete()
  const config=scoped('pos_price_tiers').doc('price-unit-evidence');await config.set({productId:local.id,productUnitId:extra.id})
  assert.equal((await catalog.get(shop,local.id)).product.units[1].canRemove,false)
  await assert.rejects(catalog.update(shop,local.id,{expectedVersion:2,units:[unitPayload[0]]},'demo-owner',randomUUID()),{status:409})
  await config.delete()
  const removed=await catalog.update(shop,local.id,{expectedVersion:2,units:[unitPayload[0]]},'demo-owner',randomUUID())
  assert.equal(removed.units.length,1)
  const edits=await Promise.allSettled(['First','Second'].map((name)=>catalog.update(shop,local.id,{name,expectedVersion:3},'demo-owner',randomUUID())))
  assert.equal(edits.filter((entry)=>entry.status==='fulfilled').length,1)
  const conflict=edits.find((entry)=>entry.status==='rejected').reason;assert.equal(conflict.status,409,conflict.stack)
  const hold=await ledger.reservation(shop,{productId:local.id,sourceType:'PosOrder',sourceId:'unit-lock',quantity:0.5},'demo-owner',randomUUID())
  assert.equal(hold.quantity,'0.5');assert.equal((await catalog.get(shop,local.id)).product.currentStock,2.5)
  const audits=(await scoped('pos_audit').get()).docs.map((doc)=>doc.data())
  assert.ok(audits.some((entry)=>entry.action==='product.unit.remove'&&entry.metadata.before.id===extra.id))
  assert.ok(audits.some((entry)=>entry.action==='product.unit.disable_sale'))
  assert.equal((await scoped('pos_units').get()).size,2)
  assert.deepEqual((await db.doc('onlineShopV2/belle-online/stock_movements/'+batchId).get()).data(),openingMovement)
  // An unused base can normally be replaced, but its barcode/price references
  // must not be orphaned simply because base rows have no Remove UI control.
  const referenced=await catalog.create(shop,{name:'Barcode unit reference',price:50,cost:25,units:[{name:'Piece',conversionFactor:1,isBase:true}],barcode:{value:'EF2468',kind:'INTERNAL'}},'demo-owner',randomUUID())
  const replacement='Uncommitted replacement '+randomUUID()
  await assert.rejects(catalog.update(shop,referenced.id,{expectedVersion:1,units:[{name:replacement,conversionFactor:1,isBase:true}]},'demo-owner',randomUUID()),{status:409})
  assert.equal((await scoped('pos_units').where('name','==',replacement).get()).size,0)
  assert.equal((await catalog.get(shop,referenced.id)).product.units[0].id,referenced.units[0].id)
})

test('Firebase API: authenticated CRUD, transactional stock/orders, private tracking and untouched legacy history', async () => {
  const owner = await token('demo-owner','owner@belle-demo.example'); const outsider = await token('demo-other','other@belle-demo.example')
  const deliveryFee=(await api('settings')).data.delivery_fee||0
  assert.equal((await api('admin/me')).status,401)
  assert.equal((await api('admin/me',undefined,outsider)).status,403)
  assert.equal((await api('admin/me',undefined,owner)).data.role,'owner')
  const legacy = { customer:{ name:'Yu Thandar Win',phone:'09942988167' },total:34500, date:'2026-07-23',paymentStatus:'unpaid',fulfillmentStatus:'reserved',items:[{type:'Elegence',size:'1',color:'Brown',quantity:1}] }
  const legacyRef = db.doc('users/demo-owner/orders/legacy-sale'); await legacyRef.set(legacy)
  const category = (await api('admin/records/categories',{name:'Dresses',display_order:0},owner)).data
  const collection = (await api('admin/records/collections',{name:'New',description:'New designs',display_order:0},owner)).data
  const guideResponse = await api('admin/records/size_guides',{name:'Sizing',fields:[{key:'weight',label:'Weight',unit:'lb'}],sizes:[{id:'1',label:'Size 1',weight:[90,120]}]},owner)
  assert.equal(guideResponse.status,200); const guide = guideResponse.data
  const data = { name:'Firebase Dress',slug:'firebase-'+randomUUID(),description:'Local test',status:'published',display_order:0,category_id:category.id,size_guide_id:guide.id,collection_ids:[collection.id],variants:[{color:'Brown',size:'1',sku:'EL-'+randomUUID(),price:34500,active:true}] }
  const created = await api('admin/products',data,owner); assert.equal(created.status,200)
  const productId = created.data; const product = (await api('admin/products/'+productId,undefined,owner)).data; const variant = product.variants[0]
  assert.equal((await api('admin/inventory',{variantId:variant.id,delta:2,note:'Initial stock'},owner)).status,200)
  assert.equal((await api('admin/records/categories/'+category.id,undefined,owner,'DELETE')).status,400)
  assert.equal((await api('admin/records/orders',{},owner)).status,400)
  assert.equal((await api('admin/records/users',undefined,owner)).status,400)
  const request = (quantity=1) => ({request_key:randomUUID(),tracking_token:'a'.repeat(64),customer:{name:'Buyer',phone:'09942988167',city:'Yangon',address:'Local test address'},note:'Private admin note',items:[{variant_id:variant.id,quantity,unit_price:1,measurements:{weight:105}}]})
  const rejected = await api('checkout',request(3)); assert.equal(rejected.status,409); assert.equal(rejected.data.order_rejected,true)
  const first = request(); const second = request(); const third = request()
  const results = await Promise.all([api('checkout',first),api('checkout',second),api('checkout',third)])
  assert.equal(results.filter((r)=>r.status===200).length,2,JSON.stringify(results))
  assert.equal(results.filter((r)=>r.status===409).length,1,JSON.stringify(results))
  const requests=[first,second,third]; const accepted=requests.filter((_r,i)=>results[i].status===200)
  const orderResult=results[requests.indexOf(accepted[0])]
  assert.deepEqual((await api('checkout',accepted[0])).data,orderResult.data)
  assert.equal((await api('checkout',{...accepted[0],note:'Changed'})).status,409)
  const reserved=(await api('admin/products/'+productId,undefined,owner)).data.variants[0]
  assert.equal(reserved.reserved,2)
  const tracked=await api('track-order',orderResult.data)
  assert.equal(tracked.status,200); assert.equal(tracked.data.total,34500+deliveryFee); assert.equal(tracked.data.items[0].name,'Firebase Dress')
  for(const field of ['phone','address','note','request_hash','tracking_hash','invoice_draft']) assert.equal(tracked.data[field],undefined)
  assert.equal((await api('track-order',{...orderResult.data,tracking_token:'b'.repeat(64)})).status,404)
  const route='admin/orders/'+accepted[0].request_key+'/transition'
  assert.equal((await api(route,{status:'confirmed'},owner)).status,200)
  const saved=(await db.doc('onlineShopV2/belle-online/orders/'+accepted[0].request_key).get()).data()
  assert.equal(saved.invoice_draft.total,34500+deliveryFee)
  for(const status of ['packing','shipped','delivered','delivered']) assert.equal((await api(route,{status,courier:'Courier'},owner)).status,200)
  const rejectRoute='admin/orders/'+accepted[1].request_key+'/transition'
  assert.equal((await api(rejectRoute,{status:'rejected'},owner)).status,200)
  assert.equal((await api(rejectRoute,{status:'rejected'},owner)).status,200)
  const finalProduct=(await api('admin/products/'+productId,undefined,owner)).data
  assert.equal(finalProduct.variants[0].on_hand,1); assert.equal(finalProduct.variants[0].reserved,0)
  assert.equal((await api('admin/inventory',{variantId:variant.id,delta:-2,note:'Invalid'},owner)).status,400)
  assert.equal((await api('admin/products',{...finalProduct,status:'hidden',collection_ids:[collection.id]},owner)).status,200)
  const catalog=(await api('catalog')).data
  assert.equal(catalog.some((p)=>p.id===productId),false)
  assert.deepEqual((await legacyRef.get()).data(),legacy)
  assert.equal((await api('admin/products/'+productId+'/gallery',{images:[{path:'https://example.com/private-image',is_cover:true}]},owner)).status,400)
  assert.equal((await api('admin/orders/expire',{},owner)).status,200)
})

test('real Firestore enforces shared abuse budgets and rejected verification cannot change orders or legacy records', async () => {
  const shop = 'security-' + randomUUID()
  const guardOptions = { db, projectId: 'demo-belle-online', emulator: true, demoBypass: true,
    rateLimitKey: 'test-key-only-isolated-firebase-emulator', now: () => 120_000 }
  const first = createPublicGuard(guardOptions); const second = createPublicGuard(guardOptions)
  const request = { headers: {}, socket: { remoteAddress: '127.0.0.1' } }
  for (let i = 0; i < 18; i++) await first(shop, 'checkout', request, {})
  const results = await Promise.allSettled([first(shop, 'checkout', request, {}), second(shop, 'checkout', request, {}), second(shop, 'checkout', request, {})])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2, JSON.stringify(results.map((r) => ({status:r.status,code:r.reason?.code,httpStatus:r.reason?.status,message:r.reason?.message}))))
  assert.equal(results.find((r) => r.status === 'rejected').reason.status, 429)
  await assert.rejects(second(shop, 'checkout', { ...request, headers: { 'x-forwarded-for': '203.0.113.10' } }, {}), { status: 429 })
  await first(shop, 'track-order', request, {})
  const limits = await db.collection(`onlineShopV2/${shop}/request_limits`).get()
  assert.equal(limits.docs.filter((d) => d.id.startsWith('checkout-')).every((d) => d.data().count === 20), true)
  assert.equal(JSON.stringify(limits.docs.map((d) => ({ id: d.id, ...d.data() }))).includes('127.0.0.1'), false)

  const protectedShop = 'verification-' + randomUUID()
  const legacyRef = db.doc('users/demo-owner/orders/legacy-sale'); const before = (await legacyRef.get()).data()
  const protectedGuard = createPublicGuard({ ...guardOptions, demoBypass: false, secret: 'test-only-provider-double', expectedHostnames: ['shop.example'],
    fetchImpl: async () => ({ ok: true, json: async () => ({ success: false, 'error-codes': ['timeout-or-duplicate'] }) }) })
  const handler = createShopApi({ db, auth, bucket: {}, publicGuard: protectedGuard, allowedShopId: protectedShop, checkoutEnabled: true })
  let status, response
  await handler({ ...request, path: `/${protectedShop}/checkout`, method: 'POST', body: { challenge: 'replayed-token' } },
    { set() {}, status(value) { status = value; return this }, json(value) { response = value } })
  assert.equal(status, 403); assert.equal(response.order_rejected, false)
  assert.equal((await db.collection(`onlineShopV2/${protectedShop}/orders`).get()).empty, true)
  assert.deepEqual((await legacyRef.get()).data(), before)
})

test('versioned cutover policy permits owner history but rejects every legacy mutation and direct private namespace access', async () => {
  const posRequire = createRequire(new URL('../../BelleLocal POS app/package.json', import.meta.url))
  const { initializeTestEnvironment, assertSucceeds, assertFails } = posRequire('@firebase/rules-unit-testing')
  const { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } = posRequire('firebase/firestore')
  const rules = await readFile(new URL('../../BelleLocal POS app/firebase-policy/2026-10-11-cutover/firestore.rules', import.meta.url), 'utf8')
  const projectId = 'demo-belle-policy'; const uid = 'UXRbRF184gcohMkl4CdS0i0rdow2'
  const environment = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080, rules } })
  try {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      for (const table of ['orders', 'payments', 'expenses', 'stocks', 'stockAdjustments', 'audit', 'catalog', 'paymentReferences', 'meta']) {
        await setDoc(doc(db, `users/${uid}/${table}/fixture`), { total: 34500, marker: 'immutable fixture' })
      }
    })
    const owner = environment.authenticatedContext(uid).firestore()
    const outsider = environment.authenticatedContext('outsider').firestore()
    const anonymous = environment.unauthenticatedContext().firestore()
    for (const table of ['orders', 'payments', 'expenses', 'stocks', 'stockAdjustments', 'audit', 'catalog', 'paymentReferences', 'meta']) {
      const path = `users/${uid}/${table}/fixture`
      await assertSucceeds(getDoc(doc(owner, path)))
      await assertSucceeds(getDocs(collection(owner, `users/${uid}/${table}`)))
      await assertFails(setDoc(doc(owner, path), { total: 0 }))
      await assertFails(updateDoc(doc(owner, path), { total: 0 }))
      await assertFails(deleteDoc(doc(owner, path)))
      await assertFails(setDoc(doc(owner, `users/${uid}/${table}/new`), { total: 0 }))
      await assertFails(getDoc(doc(outsider, path)))
      await assertFails(getDoc(doc(anonymous, path)))
      assert.equal((await getDoc(doc(owner, path))).data().total, 34500)
    }
    for (const table of ['products', 'orders', 'inventory_movements', 'request_limits']) {
      const path = `onlineShopV2/belle-online/${table}/fixture`
      await assertFails(getDoc(doc(owner, path)))
      await assertFails(getDocs(collection(owner, `onlineShopV2/belle-online/${table}`)))
      await assertFails(setDoc(doc(owner, path), { injected: true }))
    }
  } finally { await environment.cleanup() }
})

test('maintenance expires only pending reservations, cleans isolated orphan images/counters and preserves legacy and attached files', async () => {
  const owner = await token('demo-owner','owner@belle-demo.example')
  const oldDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  const shop = 'maintenance-' + randomUUID(); const bucket = getStorage().bucket('demo-belle-online.firebasestorage.app')
  const options = { db, bucket, storageOrigin: 'http://127.0.0.1:9199' }
  // A fresh namespace makes this test independent of previous interrupted runs.
  // The same API code uses real emulator Auth, Firestore and Storage here.
  const handler = createShopApi({ ...options, auth, allowedShopId: shop, ownerUid: 'demo-owner', checkoutEnabled: true,
    publicGuard: createPublicGuard({ db, projectId:'demo-belle-online', emulator:true, demoBypass:true, rateLimitKey:'isolated-maintenance-test-only-key' }) })
  async function api(route, body, bearer, method = body === undefined ? 'GET' : 'POST') {
    let status = 200, data
    await handler({ path:`/${shop}/${route}`, method, body, headers:bearer ? {authorization:'Bearer '+bearer} : {}, socket:{remoteAddress:'127.0.0.1'} },
      { set() {}, status(value) { status=value; return this }, json(value) { data=value }, send() {} })
    return {status,data}
  }
  const disabled = createMaintenanceService(options)
  await assert.rejects(disabled.run(shop), { status: 409 })
  const maintenance = createMaintenanceService({ ...options, enabled: true })
  const legacyRef = db.doc('users/demo-owner/orders/legacy-sale'); const legacyBefore = (await legacyRef.get()).data()
  const create = await api('admin/products', { name: 'Maintenance Dress', slug: 'maintenance-' + randomUUID(), status:'published', variants:[{color:'Brown',size:'S',sku:randomUUID(),price:4500,active:true}] }, owner)
  assert.equal(create.status,200); const productId = create.data
  const product = (await api('admin/products/'+productId, undefined, owner)).data; const variant = product.variants[0]
  assert.equal((await api('admin/inventory',{variantId:variant.id,delta:3},owner)).status,200)
  const order = () => ({ request_key:randomUUID(),tracking_token:'c'.repeat(64),customer:{name:'Maintenance buyer',phone:'09942988167',city:'Yangon',address:'Test address'},items:[{variant_id:variant.id,quantity:1}] })
  const pending = order(); const accepted = order()
  assert.equal((await api('checkout',pending)).status,200); assert.equal((await api('checkout',accepted)).status,200)
  assert.equal((await api(`admin/orders/${accepted.request_key}/transition`,{status:'confirmed'},owner)).status,200)
  for (const value of [pending,accepted]) await db.doc(`onlineShopV2/${shop}/orders/${value.request_key}`).update({expires_at:oldDate})
  assert.equal((await api(`admin/orders/${pending.request_key}/transition`,{status:'confirmed'},owner)).status,409)

  const bytes = await readFile(new URL('../dashboard/src/assets/products/sakura/sakura-cherry.webp', import.meta.url))
  const upload = async () => { const result = await api('admin/images',{bucket:'product-images',parentId:productId,data:bytes.toString('base64')},owner); assert.equal(result.status,200); return result.data }
  const keep = await upload(); const orphan = await upload()
  assert.equal((await api(`admin/products/${productId}/gallery`,{images:[{path:keep.path,is_cover:true}]},owner)).status,200)
  const objectName = (path) => decodeURIComponent(new URL(path).pathname.split('/o/')[1])
  const manifestId = (path) => objectName(path).split('/').at(-1).replace(/\.webp$/,'')
  for(const image of [keep,orphan]) await db.doc(`onlineShopV2/${shop}/image_uploads/${manifestId(image.path)}`).update({created_at:oldDate})
  const legacyFile = bucket.file('users/demo-owner/legacy-photo.webp'); await legacyFile.save(bytes)
  const foreignFile = bucket.file('onlineShopV2/another-shop/product-images/fixture/foreign.webp'); await foreignFile.save(bytes)
  const pastCounter = db.doc(`onlineShopV2/${shop}/request_limits/test-expired-${randomUUID()}`)
  const futureCounter = db.doc(`onlineShopV2/${shop}/request_limits/test-active-${randomUUID()}`)
  await pastCounter.set({count:1,expires_at:new Date(Date.now()-1000)})
  await futureCounter.set({count:1,expires_at:new Date(Date.now()+120000)})
  const result = await maintenance.run(shop)
  assert.equal(result.expired_orders,1); assert.equal(result.removed_images,1); assert.deepEqual(result.failed,[])
  assert.equal((await db.doc(`onlineShopV2/${shop}/orders/${pending.request_key}`).get()).data().status,'expired')
  assert.equal((await db.doc(`onlineShopV2/${shop}/orders/${accepted.request_key}`).get()).data().status,'confirmed')
  assert.equal((await api('admin/products/'+productId,undefined,owner)).data.variants[0].reserved,1)
  assert.equal((await bucket.file(objectName(keep.path)).exists())[0],true)
  assert.equal((await bucket.file(objectName(orphan.path)).exists())[0],false)
  assert.equal((await pastCounter.get()).exists,false); assert.equal((await futureCounter.get()).exists,true)
  const repeated = await maintenance.run(shop); assert.equal(repeated.expired_orders,0); assert.equal(repeated.removed_images,0)
  assert.deepEqual((await legacyRef.get()).data(),legacyBefore)
  assert.deepEqual((await legacyFile.download())[0],bytes); assert.equal((await foreignFile.exists())[0],true)

  // A malformed manifest must never point cleanup outside this shop namespace.
  const bad = db.doc(`onlineShopV2/${shop}/image_uploads/${randomUUID()}`)
  await bad.set({state:'uploaded',created_at:oldDate,folder:'product-images',parent_id:productId,object_name:legacyFile.name})
  assert.equal((await maintenance.run(shop)).failed.length,1)
  assert.equal((await legacyFile.exists())[0],true); await bad.delete()

  // Exercise gallery-save/cleanup contention with real Firestore and Storage.
  const race = await upload(); await db.doc(`onlineShopV2/${shop}/image_uploads/${manifestId(race.path)}`).update({created_at:oldDate})
  const imageService = createImageService(options)
  const attachment = await imageService.inspect(shop,race.path,'product-images',productId); assert.ok(attachment)
  const [saved] = await Promise.all([api(`admin/products/${productId}/gallery`,{images:[{path:keep.path,is_cover:true},{path:race.path,is_cover:false}]},owner),maintenance.run(shop)])
  const after = (await api('admin/products/'+productId,undefined,owner)).data
  const attached = after.images.some((image)=>image.path===race.path)
  const exists = (await bucket.file(objectName(race.path)).exists())[0]
  assert.equal(attached && !exists,false)
  if(!exists) await assert.rejects(db.runTransaction((tx)=>imageService.lockAttachments(tx,[attachment])),{status:409})
  assert.ok([200,400,409].includes(saved.status))
})

test('historical payments/completion are append-only, retry-safe and reconcile Belle finance without editing any legacy collection', async () => {
  const owner = await token('demo-owner','owner@belle-demo.example'); const outsider = await token('demo-other','other@belle-demo.example')
  const key = 'legacy-' + randomUUID(); const paidKey = 'paid-' + randomUUID(); const missingKey = 'undated-' + randomUUID()
  const original = { id:'original-internal-id', date:'2026-07-23', customer:{name:'Yu Thandar Win',phone:'09942988167',city:'Yangon'},
    total:34500, subtotal:34500, amountPaid:0, balanceDue:34500, paymentStatus:'unpaid',fulfillmentStatus:'reserved',schemaVersion:2,
    items:[{id:'line',type:'Elegence',size:'1',color:'Brown',quantity:1,unitPrice:39500,unitCost:39500,discount:5000,allocations:[{stockBatchId:'legacy-batch',quantity:1,unitCost:39500}]}], remark:'immutable note', unknownAuditField:{keep:true} }
  await db.doc('users/demo-owner/orders/'+key).set(original)
  await db.doc('users/demo-owner/orders/'+paidKey).set({...original,total:900,amountPaid:900,balanceDue:0,paymentStatus:'paid',paymentId:'historic-paid'})
  const undated = {...original}; delete undated.date
  await db.doc('users/demo-owner/orders/'+missingKey).set(undated)
  await db.doc('users/demo-owner/payments/historic-paid').set({orderId:paidKey,amount:900,method:'KBZ Pay 1',transactionId:'999991',date:'2026-07-22'})
  const baseline = new Map()
  for(const table of ['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta']) baseline.set(table,(await db.collection('users/demo-owner/'+table).get()).docs.map((doc)=>({id:doc.id,data:doc.data()})))
  assert.equal((await api('admin/history')).status,401)
  assert.equal((await api('admin/history',undefined,outsider)).status,403)
  assert.equal((await api('admin/history/records/users',undefined,owner)).status,400)
  assert.equal((await api('admin/history/records/payments',undefined,owner)).status,200)
  const source = await api('admin/history/orders/'+key,undefined,owner)
  assert.equal(source.status,200); assert.equal(source.data.original.id,key); assert.equal(source.data.source.immutable,true)
  assert.equal(source.data.effective.total,34500); assert.equal(source.data.effective.items[0].unitCost,39500)
  const before = (await api('admin/history',undefined,owner)).data
  assert.ok(before.reconciliation.anomalies.some((item)=>item.type==='missing-historical-date' && item.orderId===missingKey))
  const used = new Set(before.payments.map((payment)=>payment.transactionId))
  let references
  do { const start=randomInt(100000,999980); references=[0,1,2].map((offset)=>String(start+offset)) } while(references.some((value)=>used.has(value) || value==='999991'))
  const deposit = {action:'payment',request_key:randomUUID(),method:'KBZ Pay 1',transactionId:references[0],amount:4500,date:'2026-10-11',note:'Deposit'}
  const path = 'admin/history/orders/'+key+'/events'
  const first = await api(path,deposit,owner); assert.equal(first.status,200); assert.equal(first.data.paymentStatus,'partial'); assert.equal(first.data.balanceDue,30000)
  assert.deepEqual((await api(path,deposit,owner)).data,first.data)
  assert.equal((await api(path,{...deposit,amount:4501},owner)).status,409)
  assert.equal((await api('admin/history/orders/'+paidKey+'/events',{...deposit,request_key:randomUUID()},owner)).status,409)
  assert.equal((await api('admin/history/orders/'+missingKey+'/events',{...deposit,request_key:randomUUID(),transactionId:'999991'},owner)).status,409)
  assert.equal((await api(path,{...deposit,request_key:randomUUID(),date:'2026-99-99'},owner)).status,400)
  const finals = [0,1].map((i)=>({...deposit,request_key:randomUUID(),transactionId:references[i+1],amount:30000}))
  const results = await Promise.all(finals.map((body)=>api(path,body,owner)))
  assert.equal(results.filter((result)=>result.status===200).length,1); assert.equal(results.filter((result)=>result.status===409).length,1)
  const complete = {action:'complete',request_key:randomUUID()}
  const completed = await api(path,complete,owner); assert.equal(completed.status,200); assert.equal(completed.data.fulfillmentStatus,'completed')
  assert.deepEqual((await api(path,complete,owner)).data,completed.data)
  const saved = (await api('admin/history/orders/'+key,undefined,owner)).data
  assert.equal(saved.events.length,3); assert.equal(saved.effective.paymentStatus,'paid'); assert.equal(saved.effective.amountPaid,34500)
  assert.equal(saved.effective.items[0].allocations[0].stockBatchId,'legacy-batch')
  const after = (await api('admin/history?search='+key,undefined,owner)).data
  assert.equal(after.total,1); assert.equal(after.orders[0].id,key)
  assert.deepEqual(after.financial.original,before.financial.original)
  assert.equal(after.financial.effective.revenue-before.financial.effective.revenue,34500)
  assert.equal(after.financial.effective.costOfGoods-before.financial.effective.costOfGoods,39500)
  assert.equal(after.financial.delta.grossProfit-before.financial.delta.grossProfit,-5000)
  assert.equal(after.payments.filter((payment)=>payment.orderId===key).length,2)
  assert.equal(after.reconciliation.anomalies.some((item)=>item.type==='missing-payment' && item.orderId===key),false)
  for(const [table,rows] of baseline) assert.deepEqual((await db.collection('users/demo-owner/'+table).get()).docs.map((doc)=>({id:doc.id,data:doc.data()})),rows)

  // An old client changing the original after an overlay must not be silently
  // reinterpreted. This isolated fixture mutation simulates that external race.
  const service = createHistoryService({db,ownerUid:'demo-owner'})
  await db.doc('users/demo-owner/orders/'+key).update({total:34501})
  await assert.rejects(service.order('belle-online',key),{status:409})
  await assert.rejects(service.append('belle-online',key,{action:'complete',request_key:randomUUID()},'demo-owner'),{status:409})
  assert.ok((await service.read('belle-online')).reconciliation.anomalies.some((item)=>item.type==='legacy-source-changed' && item.orderId===key))
})

test('image cleanup advances past a full page of attached images to reach later orphans',async()=>{
  const shop='cleanup-paging-'+randomUUID(); const bucket=getStorage().bucket('demo-belle-online.firebasestorage.app')
  const images=createImageService({db,bucket,storageOrigin:'http://127.0.0.1:9199'})
  const older=new Date(Date.now()-4*24*60*60*1000).toISOString(); const old=new Date(Date.now()-3*24*60*60*1000).toISOString()
  const batch=db.batch()
  for(let parent=0;parent<10;parent++) {
    const parentId='kept-'+parent; const gallery=[]
    for(let image=0;image<10;image++) {
      const key=randomUUID(); const name=`onlineShopV2/${shop}/product-images/${parentId}/${key}.webp`
      const url=`http://127.0.0.1:9199/v0/b/${bucket.name}/o/${encodeURIComponent(name)}?alt=media&token=fixture`
      gallery.push({path:url,src:url})
      batch.create(db.doc(`onlineShopV2/${shop}/image_uploads/${key}`),{state:'uploaded',folder:'product-images',parent_id:parentId,object_name:name,url,created_at:older})
    }
    batch.create(db.doc(`onlineShopV2/${shop}/products/${parentId}`),{images:gallery})
  }
  batch.create(db.doc(`onlineShopV2/${shop}/products/orphan-parent`),{images:[]}); await batch.commit()
  const bytes=await readFile(new URL('../dashboard/src/assets/products/sakura/sakura-cherry.webp',import.meta.url))
  const upload=await images.upload(shop,{parentId:'orphan-parent',bucket:'product-images',data:bytes.toString('base64')})
  const name=decodeURIComponent(new URL(upload.path).pathname.split('/o/')[1]); const key=name.split('/').at(-1).replace(/\.webp$/,'')
  await db.doc(`onlineShopV2/${shop}/image_uploads/${key}`).update({created_at:old})
  assert.deepEqual(await images.cleanup(shop),{deleted:0,failed:[]})
  assert.equal((await bucket.file(name).exists())[0],true)
  assert.deepEqual(await images.cleanup(shop),{deleted:1,failed:[]})
  assert.equal((await bucket.file(name).exists())[0],false)
  assert.equal((await db.doc(`onlineShopV2/${shop}/maintenance_state/images`).get()).data().id,null)
})
