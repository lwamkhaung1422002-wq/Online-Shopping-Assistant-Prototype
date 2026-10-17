import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createLegacyStockOpening } from '../../BelleLocal POS app/functions/src/pos/legacy-stock-opening.js'
import { createPosCatalog } from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import { createPosOrders } from '../../BelleLocal POS app/functions/src/pos/orders.js'
import { createOrderService } from '../../BelleLocal POS app/functions/src/online-shop/orders.js'
import { createShopStock } from '../../BelleLocal POS app/functions/src/online-shop/stock.js'
import { normalizeProduct, publicProduct } from '../../BelleLocal POS app/functions/src/online-shop/domain.js'
import { stockScopeKey } from '../../BelleLocal POS app/functions/src/pos/stock-scopes.js'
import { createHistoryService } from '../../BelleLocal POS app/functions/src/pos/history.js'
import { createShopApi } from '../../BelleLocal POS app/functions/src/online-shop/api.js'
import { createPosProductReport } from '../../BelleLocal POS app/functions/src/pos/product-report.js'
import { readLegacyInventoryProjection } from '../../BelleLocal POS app/functions/src/pos/legacy-inventory-projection.js'

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw Error('Legacy opening requires isolated loopback Firebase services.')
const require = createRequire(new URL('../../BelleLocal POS app/functions/package.json', import.meta.url))
const { initializeApp } = require('firebase-admin/app'); const { getFirestore } = require('firebase-admin/firestore'); const { getAuth } = require('firebase-admin/auth')
initializeApp({ projectId: 'demo-belle-online' }); const db = getFirestore(); const auth = getAuth()
const table = (shop, name) => db.collection(`onlineShopV2/${shop}/${name}`)
const rows = async (shop, name) => (await table(shop, name).get()).docs.map((doc) => ({ ...doc.data(), id: doc.id }))
const old = (f, name, key) => db.doc(`users/${f.uid}/${name}/${key}`)
async function original(f) { return Object.fromEntries(await Promise.all(['stocks', 'orders', 'payments', 'expenses', 'stockAdjustments', 'audit', 'catalog', 'paymentReferences', 'meta'].map(async (name) => [name, (await db.collection(`users/${f.uid}/${name}`).get()).docs.map((doc) => [doc.id, doc.data()])]))) }
async function fixture() {
  const uid = 'legacy-opening-' + randomUUID(); const shop = uid
  const f = { uid, shop, catalog: createPosCatalog({ db }), pos: createPosOrders({ db }), publicOrders: createOrderService({ db, checkoutEnabled: true }), stock: createShopStock({ db }) }
  f.opening = createLegacyStockOpening({ db, ownerUid: uid, allowedShopId: shop, enabled: true })
  for (const [key, quantity, unitCost] of [['a', 3, 100], ['b', 3, 300]]) await old(f, 'stocks', key).set({ quantity, unitCost, date: '2026-07-01', size: '1', color: 'Brown', type: 'Elegence' })
  for (const [key, status, allocations] of [['explicit', 'reserved', [{ stockBatchId: 'a', quantity: 1, unitCost: 100 }]], ['fallback', 'completed', []]]) await old(f, 'orders', key).set({ date: '2026-07-23', total: 500, fulfillmentStatus: status, paymentStatus: 'unpaid', items: [{ quantity: 1, unitPrice: 500, unitCost: 100, size: '1', color: 'Brown', type: 'Elegence', allocations }] })
  for (const name of ['payments', 'expenses', 'stockAdjustments', 'audit', 'catalog', 'paymentReferences', 'meta']) await old(f, name, 'immutable').set({ original: true })
  f.product = await f.catalog.create(shop, { name: 'Actual legacy stock target', cost: 100, price: 500, units: [{ name: 'Piece', isBase: true, conversionFactor: 1 }] }, uid, randomUUID())
  f.publicProduct = normalizeProduct({ name: 'Original design public post', slug: 'opening-' + randomUUID(), status: 'published', variants: [{ sku: 'Opening', size: '1', color: 'Brown', price: 500, active: true }] }, null, shop)
  await table(shop, 'products').doc(f.publicProduct.id).set(f.publicProduct)
  await f.stock.bind(shop, { public_product_id: f.publicProduct.id, public_variant_id: f.publicProduct.variants[0].id, pos_product_id: f.product.id }, uid)
  const preview = await f.opening.preview(shop, uid)
  f.body = { expected_snapshot_hash: preview.snapshotHash, mappings: [{ legacy_variant_key: preview.variants[0].key, pos_product_id: f.product.id }] }
  return f
}
const activate = (f, key = randomUUID()) => f.opening.activate(f.shop, f.body, f.uid, key)
const balance = async (f) => (await table(f.shop, 'stock_balances').doc(stockScopeKey(f.product.id)).get()).data()
const guest = (f, quantity) => ({ request_key: randomUUID(), tracking_token: 'a'.repeat(64), customer: { name: 'Fictional guest', phone: '099999999', city: 'Yangon', address: 'Fictional address' }, items: [{ variant_id: f.publicProduct.variants[0].id, quantity, measurements: {} }] })
const sale = (f, quantity) => ({ saleType: 'IN_STORE', paymentMode: 'FULL', initialPayment: { method: 'Cash', amount: quantity * 500 }, items: [{ productId: f.product.id, quantity }] })

test('New cost correction changes only opened free-stock/new invoice costs, keeps original held/consumed costs and history frozen, and rejects changed source without repairs',async()=>{
  const f=await fixture(),before=await original(f);await activate(f)
  const created=await f.pos.create(f.shop,sale(f,1),f.uid,randomUUID(),{checkout:true}),current=(await f.catalog.get(f.shop,f.product.id)).product,groups=(await f.catalog.history(f.shop,f.product.id,'cost-groups')).groups
  const body={cost:200,expectedVersion:current.version,costCorrection:{mode:'ALL',reason:'Correct only new namespace receipt costs',expectedBatches:groups.map(row=>({id:row.id,unitCost:row.unitCost}))}},updated=await f.catalog.update(f.shop,f.product.id,body,f.uid,randomUUID())
  assert.equal(updated.cost,175);assert.equal((await f.pos.get(f.shop,created.order.id)).order.items[0].unitCost,200);const projected=(await f.catalog.get(f.shop,f.product.id)).product;assert.equal(projected.currentStock,4);assert.equal(projected.availableStock,3);assert(projected.legacyInventory.every(row=>[100,300].includes(row.unitCost)));assert.deepEqual(await original(f),before)
  await createHistoryService({db,ownerUid:f.uid}).append(f.shop,'explicit',{action:'complete',request_key:randomUUID()},f.uid);assert.equal((await f.catalog.get(f.shop,f.product.id)).product.currentStock,3);assert.equal((await f.stock.project(f.shop,[f.publicProduct]))[0].variants[0].available,3);assert.deepEqual(await original(f),before)
  const state=async()=>Object.fromEntries(await Promise.all(['stock_batches','stock_balances','stock_movements','pos_orders','pos_products','pos_requests','pos_audit'].map(async name=>[name,await rows(f.shop,name)])))
  await old(f,'stocks','a').update({unitCost:999}) // fictional negative source fixture only
  const invalid=await state();await assert.rejects(f.catalog.update(f.shop,f.product.id,{cost:250,expectedVersion:updated.version},f.uid,randomUUID()),error=>error.status===409);assert.deepEqual(await state(),invalid)
})

test('Product transfer spends only opened original free stock and preserves held/consumed rights, exact valuation, continuation and untouched originals',async()=>{
  const {createPosProductTransfers}=await import('../../BelleLocal POS app/functions/src/pos/product-transfers.js')
  const f=await fixture(),before=await original(f);await activate(f)
  const service=createPosProductTransfers({db,ownerUid:f.uid}),input={quantity:3,conversionFactor:2,newChild:{name:'Opened individual units',unitName:'Single',price:500}},preview=await service.preview(f.shop,f.product.id,input,f.uid)
  assert.equal(preview.preview.availableStock,'4');assert.equal(preview.preview.stockValue,'700')
  const result=await service.execute(f.shop,f.product.id,{...input,expectedFingerprint:preview.preview.fingerprint},f.uid,randomUUID()),child=result.product
  let source=(await f.catalog.get(f.shop,f.product.id)).product;assert.equal(source.currentStock,2);assert.equal(source.availableStock,1);assert.equal(source.currentStockValue,400);assert.equal(source.cost,200)
  assert.equal((await f.catalog.get(f.shop,child.id)).product.currentStockValue,700);assert.equal((await createPosProductReport({db}).get(f.shop)).products.find(row=>row.id===child.id).stockValue,700);assert.deepEqual(await original(f),before)
  await createHistoryService({db,ownerUid:f.uid}).append(f.shop,'explicit',{action:'complete',request_key:randomUUID()},f.uid)
  source=(await f.catalog.get(f.shop,f.product.id)).product;assert.equal(source.currentStock,1);assert.equal(source.availableStock,1);assert.equal(source.currentStockValue,300);assert.deepEqual(await original(f),before)
  const state=async()=>Object.fromEntries(await Promise.all(['stock_batches','stock_balances','stock_movements','pos_product_transfer_links','pos_product_transfers','pos_product_transfer_allocations','pos_products','pos_requests','pos_audit'].map(async name=>[name,await rows(f.shop,name)])))
  await old(f,'stocks','a').update({quantity:4}) // fictional negative source fixture only
  const invalid=await state();await assert.rejects(service.preview(f.shop,f.product.id,{quantity:0.5,childProductId:child.id},f.uid),error=>error.status===409);assert.deepEqual(await state(),invalid)
})

test('Classic adjustments change only opened free stock, preserve original held/consumed valuation and later completion, and reject changed original source',async()=>{
  const {createPosInventoryAdjustments}=await import('../../BelleLocal POS app/functions/src/pos/inventory-adjustments.js')
  const f=await fixture(),before=await original(f);await activate(f)
  const service=createPosInventoryAdjustments({db,ownerUid:f.uid}),input={productId:f.product.id,unitCost:100,quantity:1,reason:'Count original free stock only'}
  const result=await service.byCost(f.shop,input,f.uid,randomUUID());assert.equal(result.availableQuantity,1);assert.equal(result.adjustment.beforeBaseQuantity,'1');assert.equal(result.adjustment.afterBaseQuantity,'0')
  let product=(await f.catalog.get(f.shop,f.product.id)).product;assert.equal(product.currentStock,4);assert.equal(product.availableStock,3);assert.equal(product.cost,220);assert.equal((await f.stock.project(f.shop,[f.publicProduct]))[0].variants[0].available,3)
  const state=async()=>Object.fromEntries(await Promise.all(['stock_batches','stock_balances','stock_movements','pos_stock_adjustments','pos_stock_adjustment_allocations','pos_products','pos_requests','pos_audit'].map(async name=>[name,await rows(f.shop,name)]))),unchanged=await state()
  await assert.rejects(service.byCost(f.shop,{...input,quantity:0.1},f.uid,randomUUID()),/Available: 0/);assert.deepEqual(await state(),unchanged)
  await createHistoryService({db,ownerUid:f.uid}).append(f.shop,'explicit',{action:'complete',request_key:randomUUID()},f.uid)
  product=(await f.catalog.get(f.shop,f.product.id)).product;assert.equal(product.currentStock,3);assert.equal(product.availableStock,3);assert.equal(product.cost,220);assert.deepEqual(await original(f),before)
  await service.adjustBatch(f.shop,result.allocations[0].inventoryBatchId,{action:'ADD',quantity:0.5,reason:'New stock count after original completion'},f.uid,randomUUID())
  product=(await f.catalog.get(f.shop,f.product.id)).product;assert.equal(product.currentStock,3.5);assert.equal(product.availableStock,3.5);assert.equal(product.cost,209);assert.deepEqual(await original(f),before)
  await old(f,'stocks','a').update({quantity:4}) // fictional negative source fixture only
  const invalid=await state();await assert.rejects(service.byCost(f.shop,{...input,quantity:0.1},f.uid,randomUUID()),error=>error.status===409);assert.deepEqual(await state(),invalid)
})

test('Fractional original allocations, derived FIFO, valuation and POS sale preserve exact stock and immutable history',async()=>{
  const f=await fixture()
  await old(f,'stocks','a').update({quantity:2.1})
  await old(f,'stocks','b').update({quantity:2.2})
  await old(f,'orders','explicit').update({total:750,items:[{quantity:1.5,unitPrice:500,unitCost:100,size:'1',color:'Brown',type:'Elegence',allocations:[{stockBatchId:'a',quantity:0.1,unitCost:100},{stockBatchId:'b',quantity:1.4,unitCost:300}]}]})
  await old(f,'orders','fallback').update({items:[{quantity:1.1,unitPrice:500,unitCost:100,size:'1',color:'Brown',type:'Elegence',allocations:[]}]})
  const preview=await f.opening.preview(f.shop,f.uid);assert.equal(preview.variants[0].available,1.7)
  f.body.expected_snapshot_hash=preview.snapshotHash;const before=await original(f)
  assert.equal((await activate(f)).availableGranted,1.7)
  let product=(await f.catalog.get(f.shop,f.product.id)).product
  assert.equal(product.currentStock,3.2);assert.equal(product.availableStock,1.7);assert.equal(product.cost,202)
  const projected=(await f.stock.project(f.shop,[f.publicProduct]))[0]
  assert.equal(projected.variants[0].available,1.7);assert.equal(publicProduct(projected,[],[]).variants[0].available,1)
  await f.pos.create(f.shop,sale(f,0.1),f.uid,randomUUID(),{checkout:true})
  product=(await f.catalog.get(f.shop,f.product.id)).product
  assert.equal(product.currentStock,3.1);assert.equal(product.availableStock,1.6)
  await createHistoryService({db,ownerUid:f.uid}).append(f.shop,'explicit',{action:'complete',request_key:randomUUID()},f.uid)
  product=(await f.catalog.get(f.shop,f.product.id)).product
  assert.equal(product.currentStock,1.6);assert.equal(product.availableStock,1.6)
  assert.deepEqual(await original(f),before)
})

test('Exact 0.1 plus 0.2 allocation evidence reconciles the unchanged Belle binary aggregate without inventing free stock',async()=>{
  const f=await fixture()
  await old(f,'stocks','a').update({quantity:0.3})
  await old(f,'stocks','b').update({quantity:0.7})
  await old(f,'orders','fallback').delete()
  await old(f,'orders','explicit').update({items:[{quantity:1,unitPrice:500,unitCost:100,size:'1',color:'Brown',type:'Elegence',allocations:[{stockBatchId:'a',quantity:0.1,unitCost:100},{stockBatchId:'a',quantity:0.2,unitCost:100},{stockBatchId:'b',quantity:0.7,unitCost:300}]}]})
  const preview=await f.opening.preview(f.shop,f.uid);assert.equal(preview.variants[0].available,0)
  f.body.expected_snapshot_hash=preview.snapshotHash;const before=await original(f)
  assert.equal((await activate(f)).availableGranted,0)
  const product=(await f.catalog.get(f.shop,f.product.id)).product
  assert.equal(product.currentStock,1);assert.equal(product.availableStock,0);assert.equal(product.cost,240)
  assert.equal((await rows(f.shop,'stock_batches')).length,0)
  assert.deepEqual(await original(f),before)
})

test('Unsupported fractional source inputs and sub-unit allocation inconsistent with Belle normalization reject before opening writes',async()=>{
  for(const kind of ['stock-scale','allocation-scale','sub-unit']){
    const f=await fixture()
    if(kind==='stock-scale')await old(f,'stocks','a').update({quantity:3.0001})
    else await old(f,'orders','explicit').update({items:[{quantity:kind==='sub-unit'?0.5:1,unitPrice:500,unitCost:100,size:'1',color:'Brown',type:'Elegence',allocations:[{stockBatchId:'a',quantity:kind==='sub-unit'?0.5:1.0001,unitCost:100}]}]})
    const before=await original(f)
    await assert.rejects(f.opening.preview(f.shop,f.uid),error=>error.status===409)
    await assert.rejects(activate(f),error=>error.status===409)
    assert.equal((await rows(f.shop,'legacy_stock_baselines')).length,0)
    assert.equal((await rows(f.shop,'stock_batches')).length,0)
    assert.deepEqual(await original(f),before)
  }
})

test('Original gross valuation survives new stock receipts and old completion; main owner inventory/report and public free stock reconcile', async () => {
  const f = await fixture(); const before = await original(f); await activate(f)
  const report = createPosProductReport({db})
  let row = (await report.get(f.shop)).products.find(value => value.id === f.product.id)
  assert.equal(row.currentStock,5); assert.equal(row.averageCost,200); assert.equal(row.stockValue,1000)
  await f.catalog.receive(f.shop,{productId:f.product.id,quantity:2,unitCost:400},f.uid,randomUUID())
  let product=(await f.catalog.get(f.shop,f.product.id)).product
  // Original gross 6 at value 1200, plus 2 at 400 => 2000 / 8 = 250.
  assert.equal(product.cost,250); assert.equal(product.currentStock,7); assert.equal(product.availableStock,6)
  assert.equal((await f.stock.project(f.shop,[f.publicProduct]))[0].variants[0].available,6)
  await createHistoryService({db,ownerUid:f.uid}).append(f.shop,'explicit',{action:'complete',request_key:randomUUID()},f.uid)
  product=(await f.catalog.get(f.shop,f.product.id)).product
  assert.equal(product.currentStock,6); assert.equal(product.availableStock,6); assert.equal(product.cost,250)
  row=(await report.get(f.shop)).products.find(value=>value.id===f.product.id)
  assert.equal(row.currentStock,6); assert.equal(row.stockValue,1500)
  assert.deepEqual(await original(f),before)
})

test('Multiple allocation-less original orders keep deterministic derived FIFO ownership while completion changes only original active holds',async()=>{
  const f=await fixture()
  await old(f,'orders','zz-active').set({date:'2026-07-24',total:1000,paymentStatus:'unpaid',fulfillmentStatus:'reserved',items:[{quantity:2,unitPrice:500,unitCost:100,size:'1',color:'Brown',type:'Elegence',allocations:[]}]})
  f.body.expected_snapshot_hash=(await f.opening.preview(f.shop,f.uid)).snapshotHash
  const before=await original(f);await activate(f)
  const read=()=>db.runTransaction(tx=>readLegacyInventoryProjection(tx,db,f.shop),{readOnly:true})
  const initial=await read();const allocations=initial.batches.flatMap(batch=>batch.allocations)
  assert.equal(allocations.filter(value=>value.orderId==='zz-active').reduce((sum,value)=>sum+value.quantity,0),2)
  assert.ok(allocations.filter(value=>value.orderId==='zz-active').every(value=>value.derived===true))
  assert.ok(allocations.filter(value=>value.orderId==='explicit').every(value=>value.derived===false))
  assert.equal((await f.catalog.get(f.shop,f.product.id)).product.currentStock,5)
  await createHistoryService({db,ownerUid:f.uid}).append(f.shop,'zz-active',{action:'complete',request_key:randomUUID()},f.uid)
  const final=await read();assert.equal(final.batches.reduce((sum,batch)=>sum+Number(batch.heldBaseQuantity),0),1)
  assert.equal(final.batches.reduce((sum,batch)=>sum+Number(batch.consumedBaseQuantity),0),3)
  const product=(await f.catalog.get(f.shop,f.product.id)).product
  assert.equal(product.currentStock,3);assert.equal(product.availableStock,2)
  assert.deepEqual(await original(f),before)
})

test('Tampered continuation receipts reject owner inventory, main Product Report, public stock and new receipts without stock writes',async()=>{
  const f=await fixture();await activate(f);const before=await original(f)
  await createHistoryService({db,ownerUid:f.uid}).append(f.shop,'explicit',{action:'payment',request_key:randomUUID(),amount:100,method:'KBZ Pay 1',transactionId:'110009',date:'2026-10-12'},f.uid)
  const payment=(await table(f.shop,'pos_payments').where('source','==','legacy-overlay').get()).docs[0]
  await payment.ref.update({amount:101}) // fictional negative fixture only
  const stockBefore=await rows(f.shop,'stock_batches')
  const conflict=error=>error.status===409&&error.code==='HISTORY_RECONCILIATION_REQUIRED'
  await assert.rejects(f.catalog.get(f.shop,f.product.id),conflict)
  await assert.rejects(createPosProductReport({db}).get(f.shop),conflict)
  await assert.rejects(f.stock.project(f.shop,[f.publicProduct]),conflict)
  await assert.rejects(f.catalog.receive(f.shop,{productId:f.product.id,quantity:1,unitCost:200},f.uid,randomUUID()),conflict)
  assert.deepEqual(await rows(f.shop,'stock_batches'),stockBefore)
  assert.deepEqual(await original(f),before)
})

test('A zero-free original pool maps held/consumed rights and gross cost without inventing operational stock receipts, then completes once',async()=>{
  const f=await fixture()
  await old(f,'orders','explicit').set({date:'2026-07-23',total:1500,paymentStatus:'unpaid',fulfillmentStatus:'reserved',items:[{quantity:3,unitPrice:500,unitCost:100,size:'1',color:'Brown',type:'Elegence',allocations:[{stockBatchId:'a',quantity:3,unitCost:100}]}]})
  await old(f,'orders','fallback').set({date:'2026-07-24',total:1500,paymentStatus:'unpaid',fulfillmentStatus:'completed',items:[{quantity:3,unitPrice:500,unitCost:300,size:'1',color:'Brown',type:'Elegence',allocations:[]}]})
  const preview=await f.opening.preview(f.shop,f.uid);assert.equal(preview.variants.length,1);assert.equal(preview.variants[0].available,0);assert.equal(preview.batches.length,0)
  f.body.expected_snapshot_hash=preview.snapshotHash;const before=await original(f)
  const key=randomUUID(),result=await activate(f,key);assert.equal(result.availableGranted,0);assert.deepEqual(result.inventoryBatchIds,[])
  for(const name of ['stock_batches','stock_balances','stock_movements','stock_requests'])assert.equal((await rows(f.shop,name)).length,0)
  let product=(await f.catalog.get(f.shop,f.product.id)).product
  assert.equal(product.currentStock,3);assert.equal(product.availableStock,0);assert.equal(product.cost,200)
  assert.equal((await f.stock.project(f.shop,[f.publicProduct]))[0].variants[0].available,0)
  await assert.rejects(f.publicOrders.checkout(f.shop,guest(f,1)),error=>[400,409].includes(error.status))
  assert.equal((await activate(f,key)).replayed,true);assert.equal((await activate(f)).replayed,true)
  await createHistoryService({db,ownerUid:f.uid}).append(f.shop,'explicit',{action:'complete',request_key:randomUUID()},f.uid)
  product=(await f.catalog.get(f.shop,f.product.id)).product
  assert.equal(product.currentStock,0);assert.equal(product.availableStock,0);assert.equal(product.cost,200)
  const row=(await createPosProductReport({db}).get(f.shop)).products.find(value=>value.id===f.product.id)
  assert.equal(row.currentStock,0);assert.equal(row.stockValue,0)
  assert.deepEqual(await original(f),before)
})

test('Mixed free and fully held original variants require every mapping and validate zero-free targets before any receipt or baseline is written',async()=>{
  const f=await fixture()
  await old(f,'stocks','held-only').set({date:'2026-07-02',quantity:2,unitCost:700,size:'2',color:'Brown',type:'Elegence'})
  await old(f,'orders','held-only').set({date:'2026-07-23',total:1800,paymentStatus:'unpaid',fulfillmentStatus:'reserved',items:[{quantity:2,unitPrice:900,unitCost:700,size:'2',color:'Brown',type:'Elegence',allocations:[{stockBatchId:'held-only',quantity:2,unitCost:700}]}]})
  const preview=await f.opening.preview(f.shop,f.uid);assert.equal(preview.variants.length,2)
  f.body.expected_snapshot_hash=preview.snapshotHash
  await assert.rejects(activate(f),error=>error.status===400)
  const zero=await f.catalog.create(f.shop,{name:'Actual held-only target',cost:100,price:900,units:[{name:'Piece',isBase:true,conversionFactor:1}]},f.uid,randomUUID())
  f.body.mappings.push({legacy_variant_key:preview.variants.find(value=>value.available===0).key,pos_product_id:zero.id})
  const target=table(f.shop,'pos_products').doc(zero.id)
  await target.update({isActive:false});await assert.rejects(activate(f),error=>error.status===400)
  assert.equal((await rows(f.shop,'stock_batches')).length,0);assert.equal((await rows(f.shop,'legacy_stock_baselines')).length,0)
  await target.update({isActive:true})
  const before=await original(f);const result=await activate(f);assert.equal(result.availableGranted,4)
  const product=(await f.catalog.get(f.shop,zero.id)).product
  assert.equal(product.currentStock,2);assert.equal(product.availableStock,0);assert.equal(product.cost,700)
  assert.equal((await rows(f.shop,'stock_batches')).filter(batch=>batch.productId===zero.id).length,0)
  assert.deepEqual(await original(f),before)
})

test('Frozen source opening excludes explicit and completed allocation-less reservations, keeps costs/FIFO identities and leaves all original collections unchanged', async () => {
  const f = await fixture(); const before = await original(f); const preview = await f.opening.preview(f.shop, f.uid)
  assert.equal(preview.variants[0].available, 4); assert.equal(preview.batches.find((batch) => batch.batchId === 'a').originalReserved, 2)
  const result = await activate(f); assert.equal(result.availableGranted, 4); assert.equal((await balance(f)).onHand, '4')
  const batches = await rows(f.shop, 'stock_batches'); assert.deepEqual(batches.map((value) => [value.legacySource.batchId, value.physicalBaseQuantity, value.unitCost]).sort(), [['a', '1', 100], ['b', '3', 300]])
  // Full original gross cost: 3*100 + 3*300 over 6, not free-pool cost 250.
  assert.equal((await table(f.shop, 'pos_products').doc(f.product.id).get()).data().cost, 200)
  const inventoryBefore = (await f.catalog.get(f.shop, f.product.id)).product
  assert.equal(inventoryBefore.currentStock, 5); assert.equal(inventoryBefore.availableStock, 4)
  assert.equal(inventoryBefore.legacyInventory.reduce((sum,batch)=>sum+Number(batch.heldBaseQuantity),0),1)
  assert.equal(inventoryBefore.legacyInventory.reduce((sum,batch)=>sum+Number(batch.consumedBaseQuantity),0),1)
  const projection = await f.stock.project(f.shop, [f.publicProduct]); assert.equal(projection[0].variants[0].available, 4)
  const purchase = guest(f, 1); await f.publicOrders.checkout(f.shop, purchase)
  const hold = (await rows(f.shop, 'stock_reservations')).find((value) => value.sourceId === purchase.request_key)
  assert.equal(batches.find((batch) => batch.id === hold.allocations[0].inventoryBatchId).legacySource.batchId, 'a')
  assert.equal((await f.catalog.get(f.shop, f.product.id)).product.availableStock, 3)
  const history=createHistoryService({db,ownerUid:f.uid})
  await history.append(f.shop,'explicit',{action:'payment',request_key:randomUUID(),amount:500,method:'KBZ Pay 1',transactionId:'110001',date:'2026-10-12'},f.uid)
  assert.equal((await f.catalog.get(f.shop,f.product.id)).product.currentStock,5)
  await history.append(f.shop,'explicit',{action:'complete',request_key:randomUUID()},f.uid)
  const inventoryAfter = (await f.catalog.get(f.shop,f.product.id)).product
  assert.equal(inventoryAfter.currentStock,4); assert.equal(inventoryAfter.availableStock,3)
  assert.equal(inventoryAfter.legacyInventory.reduce((sum,batch)=>sum+Number(batch.heldBaseQuantity),0),0)
  assert.equal(inventoryAfter.legacyInventory.reduce((sum,batch)=>sum+Number(batch.consumedBaseQuantity),0),2)
  assert.equal((await f.stock.project(f.shop,[f.publicProduct]))[0].variants[0].available,3)
  assert.equal((await f.opening.preview(f.shop,f.uid)).currentOpening.availableGranted,4)
  assert.deepEqual(await original(f), before)
})

test('Actual API with verified emulator owner/outsider tokens gates preview and activation; client enabled fields cannot certify a writer freeze',async()=>{
  const f=await fixture()
  async function token(uid){const email=uid+'@belle-demo.example';await auth.createUser({uid,email,password:'Local-test-only-123!'});const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});assert.equal(response.status,200);return (await response.json()).idToken}
  const owner=await token(f.uid),outsider=await token('outsider-'+randomUUID())
  const handler=createShopApi({db,auth,ownerUid:f.uid,allowedShopId:f.shop})
  const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');req.path=url.pathname;req.query=Object.fromEntries(url.searchParams);let raw='';for await(const chunk of req)raw+=chunk;req.body=raw?JSON.parse(raw):undefined;res.set=(key,value)=>res.setHeader(key,value);res.status=value=>{res.statusCode=value;return res};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))};res.send=value=>res.end(value);await handler(req,res)})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  const url=`http://127.0.0.1:${server.address().port}/${f.shop}/admin/stock/legacy-opening`
  async function http(bearer,body){const response=await fetch(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()}}
  try{assert.equal((await http()).status,401);assert.equal((await http(outsider)).status,403);const preview=await http(owner);assert.equal(preview.status,200);assert.equal(preview.data.variants[0].available,4);assert.equal(preview.data.activationEnabled,false);assert.equal((await http(owner,{...f.body,enabled:true})).status,409);assert.equal((await rows(f.shop,'stock_batches')).length,0)}finally{await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections()})}
})

test('Concurrent activation keys grant source units once, mapping changes conflict and another shop cannot claim the same original stock', async () => {
  const f = await fixture(); const results = await Promise.all(Array.from({ length: 4 }, () => activate(f)))
  assert.equal(results.filter((value) => !value.replayed).length, 1); assert.equal((await rows(f.shop, 'stock_batches')).length, 2); assert.equal((await balance(f)).onHand, '4')
  const changed = { ...f.body, mappings: [{ ...f.body.mappings[0], pos_product_id: 'different' }] }
  await assert.rejects(f.opening.activate(f.shop, changed, f.uid, randomUUID()), (error) => error.status === 409)
  const otherShop = 'other-' + randomUUID(); const other = createLegacyStockOpening({ db, ownerUid: f.uid, allowedShopId: otherShop, enabled: true })
  await assert.rejects(other.activate(otherShop, f.body, f.uid, randomUUID()), (error) => error.status === 409)
})

test('Real public and retained POS checkout contend for the same original available units; accept/POS handover retains the exact single hold', async () => {
  const f = await fixture(); const before = await original(f); await activate(f)
  const request = guest(f, 3)
  const results = await Promise.allSettled([f.publicOrders.checkout(f.shop, request), f.pos.create(f.shop, sale(f, 3), f.uid, randomUUID(), { checkout: true })])
  assert.equal(results.filter((value) => value.status === 'fulfilled').length, 1)
  const failed = results.find((value) => value.status === 'rejected')
  assert.ok([400,409].includes(failed.reason.status),failed.reason.message)
  assert.match(failed.reason.message,/stock|inventory|available/i)
  assert.equal((await f.stock.project(f.shop, [f.publicProduct]))[0].variants[0].available, 1)
  if (results[0].status === 'fulfilled') {
    const held = await balance(f); await f.publicOrders.transition(f.shop, request.request_key, { status: 'confirmed' }, f.uid)
    const created = await f.pos.handover(f.shop, request.request_key, { paymentMode: 'FULL', initialPayment: { method: 'Cash', amount: 1500 } }, f.uid, randomUUID())
    assert.equal(created.order.total, 1500); assert.equal((await balance(f)).reserved, held.reserved); assert.equal((await balance(f)).onHand, held.onHand)
    assert.deepEqual((await rows(f.shop, 'stock_reservations')).map((value) => value.status).sort(), ['ACTIVE', 'TRANSFERRED'])
  }
  await assert.rejects(f.publicOrders.checkout(f.shop, guest(f, 2)), (error) => error.status === 409)
  assert.deepEqual(await original(f), before)
})

test('Source drift after preview or activation fails inside stock transactions/readers with no new stock/order mutation', async () => {
  const f = await fixture(); await old(f, 'stocks', 'a').update({ quantity: 4 })
  await assert.rejects(activate(f), (error) => error.status === 409); assert.equal((await rows(f.shop, 'stock_batches')).length, 0)
  f.body.expected_snapshot_hash = (await f.opening.preview(f.shop, f.uid)).snapshotHash; await activate(f)
  const before = await balance(f); await old(f, 'orders', 'explicit').update({ fulfillmentStatus: 'cancelled' })
  await assert.rejects(f.publicOrders.checkout(f.shop, guest(f, 1)), (error) => error.status === 409)
  await assert.rejects(f.pos.create(f.shop, sale(f, 1), f.uid, randomUUID(), { checkout: true }), (error) => error.status === 409)
  await assert.rejects(f.stock.project(f.shop, [f.publicProduct]), (error) => error.status === 409)
  await assert.rejects(f.catalog.get(f.shop, f.product.id), (error) => error.status === 409)
  assert.deepEqual(await balance(f), before); assert.equal((await rows(f.shop, 'pos_orders')).length, 0); assert.equal((await rows(f.shop, 'orders')).length, 0)
})

test('Trusted freeze gate, fixed owner/shop, missing mappings, nonempty targets and late invalid product reject before any opening writes', async () => {
  const f = await fixture(); const disabled = createLegacyStockOpening({ db, ownerUid: f.uid, allowedShopId: f.shop })
  await assert.rejects(disabled.activate(f.shop, { ...f.body, enabled: true }, f.uid, randomUUID()), (error) => error.status === 409)
  await assert.rejects(f.opening.preview(f.shop, 'other-owner'), (error) => error.status === 403)
  await assert.rejects(f.opening.preview('other-shop', f.uid), (error) => error.status === 404)
  await assert.rejects(f.opening.activate(f.shop, { ...f.body, mappings: [] }, f.uid, randomUUID()), (error) => error.status === 400)
  await assert.rejects(f.opening.activate(f.shop, { ...f.body, mappings: [{ ...f.body.mappings[0], pos_product_id: 'missing' }] }, f.uid, randomUUID()), (error) => error.status === 404)
  assert.equal((await rows(f.shop, 'stock_batches')).length, 0)
  await f.catalog.receive(f.shop, { productId: f.product.id, quantity: 1, unitCost: 100 }, f.uid, randomUUID())
  await assert.rejects(activate(f), (error) => error.status === 409)
  assert.equal((await rows(f.shop, 'stock_batches')).length, 1); assert.equal((await rows(f.shop, 'legacy_stock_baselines')).length, 0)
})

test('Actual Firebase owner token cannot edit original source or opening sidecars through client Firestore rules', async () => {
  const f = await fixture(); const email = f.uid + '@belle-demo.example'; await auth.createUser({ uid: f.uid, email, password: 'Local-test-only-123!' })
  const login = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Local-test-only-123!', returnSecureToken: true }) })
  assert.equal(login.status, 200); const token = (await login.json()).idToken; const before = await original(f)
  for (const path of [`users/${f.uid}/stocks/a`, `onlineShopV2/${f.shop}/legacy_stock_baselines/main`]) {
    const response = await fetch(`http://127.0.0.1:8080/v1/projects/demo-belle-online/databases/(default)/documents/${path}?updateMask.fieldPaths=quantity`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ fields: { quantity: { integerValue: '999' } } }) })
    assert.equal(response.status, 403, await response.text())
  }
  assert.deepEqual(await original(f), before)
})
