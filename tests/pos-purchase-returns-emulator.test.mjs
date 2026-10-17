import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {createPosPurchases} from '../../BelleLocal POS app/functions/src/pos/purchases.js'
import {createPosCatalog} from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import {createPosLocations} from '../../BelleLocal POS app/functions/src/pos/locations.js'
import {createStockLedger,stockScopeKey} from '../../BelleLocal POS app/functions/src/pos/stock-ledger.js'
import {createPosOrders} from '../../BelleLocal POS app/functions/src/pos/orders.js'
import {signatureFixture} from './handover-signature-fixture.mjs'
import {createShopStock} from '../../BelleLocal POS app/functions/src/online-shop/stock.js'
import {createOrderService} from '../../BelleLocal POS app/functions/src/online-shop/orders.js'
import {normalizeProduct} from '../../BelleLocal POS app/functions/src/online-shop/domain.js'
import {createPosProductTransfers} from '../../BelleLocal POS app/functions/src/pos/product-transfers.js'
import {createPosInventoryTransfers} from '../../BelleLocal POS app/functions/src/pos/inventory-transfers.js'
import {releasePosCapabilities} from './pos-release-fixture.mjs'
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Supplier returns require isolated loopback Firebase emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url)),{initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
initializeApp({projectId:'demo-belle-online'});const db=getFirestore(),auth=getAuth(),purchases=createPosPurchases({db}),catalog=createPosCatalog({db}),locations=createPosLocations({db}),ledger=createStockLedger({db}),pos=createPosOrders({db})
const table=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`),rows=async(shop,name)=>(await table(shop,name).get()).docs.map(row=>[row.id,row.data()])
const names=['pos_purchases','pos_purchase_receipts','pos_purchase_returns','pos_purchase_payments','pos_purchase_payment_reversals','pos_products','stock_batches','stock_balances','stock_movements','stock_reservations','pos_requests','pos_audit','pos_catalog_locks','pos_inventory_lots','pos_inventory_serials','pos_orders','pos_payments','pos_product_transfer_links','pos_product_transfer_allocations','pos_product_transfers']
const state=async shop=>Object.fromEntries(await Promise.all(names.map(async name=>[name,await rows(shop,name)])))
async function fixture(shop='purchase-return-'+randomUUID(),extra={}){const supplier={id:randomUUID(),shopId:shop,name:'Return supplier '+randomUUID(),isActive:true,createdAt:'2026-10-01',updatedAt:'2026-10-01'};await table(shop,'pos_suppliers').doc(supplier.id).set(supplier);if(extra.trackingMode){const keys=['inventory.lots','inventory.expiry','inventory.serials'];await releasePosCapabilities(db,shop,keys);await table(shop,'pos_settings').doc('main').set({capabilities:Object.fromEntries(keys.map(key=>[key,true]))})}return {shop,supplier,product:await catalog.create(shop,{name:'Return product '+randomUUID(),cost:100,price:500,units:[{name:'Piece',isBase:true,conversionFactor:1}],...extra},'demo-owner',randomUUID())}}
async function received(f,quantity=3,cost=100,extra={},receiptExtra={}){const created=await purchases.create(f.shop,{supplierId:f.supplier.id,items:[{productId:f.product.id,quantity,unitCost:cost}],...extra},'demo-owner',randomUUID());await purchases.send(f.shop,created.purchase.id,'demo-owner');return (await purchases.receive(f.shop,created.purchase.id,{items:[{purchaseItemId:created.purchase.items[0].id,quantity,...receiptExtra}]},'demo-owner',randomUUID())).purchase}
const returned=(f,purchase,quantity,extra={},key=randomUUID())=>purchases.returnStock(f.shop,purchase.id,{purchaseReceiptId:purchase.receipts[0].id,quantity,reason:'Supplier damaged supply',...extra},'demo-owner',key)
const cash=amount=>({amount,method:'Cash',signatureDataUrl:signatureFixture()})
const sale=(f,quantity,item={})=>pos.create(f.shop,{saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{method:'Cash',amount:f.product.price*quantity},items:[{productId:f.product.id,quantity,...item}]},'demo-owner',randomUUID(),{checkout:true})
async function token(uid,email){try{await auth.createUser({uid,email,password:'Local-test-only-123!'})}catch(error){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(error.code))throw error}const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});assert.equal(response.status,200);return (await response.json()).idToken}
async function http(path,owner,body,key){const response=await fetch('http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer '+owner}:{}),...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)});return {status:response.status,data:await response.json()}}

test('Owner supplier-return HTTP preserves all legacy and original receipt/payment/movement evidence; supplied and fallback keys cannot decrement twice',async()=>{
  const f=await fixture('belle-online'),purchase=await received(f),owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example'),key=randomUUID(),body={purchaseReceiptId:purchase.receipts[0].id,quantity:1,reason:' Damaged supply ',returnedAt:'2026-10-04',actorId:'forged'},path='purchases/'+purchase.id+'/returns'
  const legacyNames=['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta'],legacyId='return-legacy-'+randomUUID(),original={status:'reserved',paymentStatus:'unpaid',total:34500}
  for(const name of legacyNames)await db.doc(`users/demo-owner/${name}/${legacyId}`).set(original)
  const before=await state(f.shop);assert.equal((await http(path,undefined,body,key)).status,401);assert.equal((await http(path,other,body,key)).status,403);assert.deepEqual(await state(f.shop),before)
  const first=await http(path,owner,body,key);assert.equal(first.status,201);assert.equal(first.data.purchase.total,200);assert.equal(first.data.purchase.status,'partially_returned');assert.equal(first.data.purchase.receivedAt,purchase.receivedAt);assert.equal(first.data.purchase.paymentStatus,'unpaid')
  const record=first.data.purchase.returns[0];assert.equal(record.reason,'Damaged supply');assert.equal(record.returnedAt,'2026-10-04T00:00:00.000Z');assert.equal(record.amount,100);assert.equal(record.baseQuantity,'1');assert.equal(first.data.purchase.items[0].receivedBaseQuantity,'2')
  const movement=(await rows(f.shop,'stock_movements')).map(row=>row[1]).find(row=>row.sourceId===purchase.id&&row.type==='SUPPLIER_RETURN');assert.equal(movement.direction,'OUT');assert.equal(movement.sourceType,'PurchaseReturn');assert.equal(movement.idempotencyKey,key);assert.equal(movement.locationId,purchase.receipts[0].inventoryBatch.locationId);assert.equal(movement.actorUid,'demo-owner');assert.equal(movement.occurredAt,record.returnedAt);assert.equal(movement.enteredQuantity,'1');assert.equal(movement.conversionFactor,'1')
  const after=await state(f.shop);assert.deepEqual((await http(path,owner,body,key)).data,first.data);assert.equal((await http(path,owner,{...body,quantity:2},key)).status,409);assert.deepEqual(await state(f.shop),after)
  const fallback={...body,quantity:0.5,reason:'Fallback key'};const second=await http(path,owner,fallback);assert.equal(second.status,201);const fallbackState=await state(f.shop);assert.deepEqual((await http(path,owner,fallback)).data,second.data);assert.deepEqual(await state(f.shop),fallbackState)
  const current=new Map(await rows(f.shop,'stock_movements'));for(const [id,row]of before.stock_movements)assert.deepEqual(current.get(id),row)
  assert.deepEqual(await rows(f.shop,'pos_purchase_receipts'),before.pos_purchase_receipts);assert.deepEqual(await rows(f.shop,'pos_purchase_payments'),before.pos_purchase_payments)
  for(const name of legacyNames)assert.deepEqual((await db.doc(`users/demo-owner/${name}/${legacyId}`).get()).data(),original)
})

test('Return uses original loaded batch cost, exact remaining received rounding and no current-unit precision or lifecycle whitelist',async()=>{
  const f=await fixture(),created=(await purchases.create(f.shop,{supplierId:f.supplier.id,deliveryCost:10,items:[{productId:f.product.id,quantity:0.8,unitCost:100}]},'demo-owner',randomUUID())).purchase
  await purchases.send(f.shop,created.id,'demo-owner')
  const first=(await purchases.receive(f.shop,created.id,{confirmPriceChanges:true,items:[{purchaseItemId:created.items[0].id,quantity:0.4,actualUnitCost:200}]},'demo-owner',randomUUID())).purchase
  const second=(await purchases.receive(f.shop,created.id,{items:[{purchaseItemId:created.items[0].id,quantity:0.4}]},'demo-owner',randomUUID())).purchase
  assert.equal(second.items[0].receivedQuantity,0);assert.equal(second.total,170)
  await table(f.shop,'pos_units').doc(f.product.units.find(row=>row.isBase).unitId).update({precision:0})
  const result=await returned(f,first,0.1);assert.equal(result.purchase.returns[0].amount,10);assert.equal(result.purchase.total,160);assert.equal(result.purchase.items[0].receivedBaseQuantity,'0.7');assert.equal(result.purchase.items[0].receivedQuantity,1);assert.equal((await catalog.get(f.shop,f.product.id)).product.cost,157)
  const originalReturns=await rows(f.shop,'pos_purchase_returns');await table(f.shop,'pos_products').doc(f.product.id).update({isActive:false})
  const tiny=await returned(f,first,0.0001);assert.equal(tiny.purchase.returns.at(-1).baseQuantity,'0');assert.equal(tiny.purchase.total,160);assert.equal(tiny.purchase.items[0].receivedBaseQuantity,'0.7');assert.equal(tiny.purchase.status,'partially_returned')
  const final=new Map(await rows(f.shop,'pos_purchase_returns'));for(const [id,row]of originalReturns)assert.deepEqual(final.get(id),row)
})

test('Real sold and held stock cannot be returned; its location/variant physical balance and gross weighted cost preserve consumed/held counters',async()=>{
  const f=await fixture(undefined,{optionTree:{levels:[{id:'color',label:'Color'}],values:[{id:'brown',label:'Brown',level:0}]}}),a=(await locations.create(f.shop,{name:'A'})).location,b=(await locations.create(f.shop,{name:'B'})).location
  const variant=(await catalog.variants.save(f.shop,f.product.id,null,{optionPath:[{level:0,label:'Color',valueId:'brown',value:'Brown'}]},'demo-owner')).variant
  const purchase=(await purchases.create(f.shop,{supplierId:f.supplier.id,items:[{productId:f.product.id,quantity:4,unitCost:100},{productId:f.product.id,quantity:4,unitCost:300},{productId:f.product.id,variantId:variant.id,quantity:2,unitCost:500}]},'demo-owner',randomUUID())).purchase;await purchases.send(f.shop,purchase.id,'demo-owner')
  // FIFO sorts same-date batches by UUID. Use two real dated receipts so the
  // sold/held counter assertions always target the intended original batch.
  await purchases.receive(f.shop,purchase.id,{receivedAt:'2026-10-01',items:[{purchaseItemId:purchase.items[0].id,quantity:4,locationId:b.id}]},'demo-owner',randomUUID())
  const receivedPurchase=(await purchases.receive(f.shop,purchase.id,{receivedAt:'2026-10-02',items:purchase.items.slice(1).map((row,index)=>({purchaseItemId:row.id,quantity:index===1?2:4,locationId:a.id}))},'demo-owner',randomUUID())).purchase
  await pos.create(f.shop,{saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{method:'Cash',amount:500},items:[{productId:f.product.id,quantity:1}]},'demo-owner',randomUUID(),{checkout:true})
  await ledger.reservation(f.shop,{productId:f.product.id,sourceType:'Return-test',sourceId:'held',quantity:2},'demo-owner',randomUUID())
  const first=receivedPurchase.receipts[0],batch=(await table(f.shop,'stock_batches').doc(first.inventoryBatchId).get()).data();assert.equal(batch.consumedBaseQuantity,'1');assert.equal(batch.heldBaseQuantity,'2')
  const before=await state(f.shop);await assert.rejects(returned(f,receivedPurchase,2),{status:400});assert.deepEqual(await state(f.shop),before)
  const result=await returned(f,receivedPurchase,1);assert.equal(result.purchase.total,2500);const current=(await table(f.shop,'stock_batches').doc(batch.id).get()).data();assert.equal(current.baseQuantity,'3');assert.equal(current.physicalBaseQuantity,'2');assert.equal(current.heldBaseQuantity,'2');assert.equal(current.consumedBaseQuantity,'1');assert.equal(current.reservedBaseQuantity,'3')
  const balances=new Map(await rows(f.shop,'stock_balances'));assert.equal(balances.get(stockScopeKey(f.product.id,null,b.id)).onHand,'2');assert.equal(balances.get(stockScopeKey(f.product.id,null,b.id)).reserved,'2');assert.equal(balances.get(stockScopeKey(f.product.id,null,a.id)).onHand,'4');assert.equal(balances.get(stockScopeKey(f.product.id,variant.id,a.id)).onHand,'2');assert.equal((await catalog.get(f.shop,f.product.id)).product.cost,278)
  assert.deepEqual(await rows(f.shop,'stock_reservations'),before.stock_reservations);assert.deepEqual(await rows(f.shop,'pos_purchase_receipts'),before.pos_purchase_receipts)
})

test('Financial validation, scope mismatches, oversized and unknown linkage/correction evidence roll back stock, returns and audit',async()=>{
  const f=await fixture(),purchase=await received(f);await purchases.pay(f.shop,purchase.id,cash(300),'demo-owner',randomUUID());const before=await state(f.shop)
  await assert.rejects(returned(f,purchase,1),/Refund or void/);assert.deepEqual(await state(f.shop),before)
  const payment=(await rows(f.shop,'pos_purchase_payments'))[0][1];await purchases.reversePayment(f.shop,purchase.id,payment.id,{reason:'Return preparation'},'demo-owner')
  for(const body of [{quantity:4},{purchaseReceiptId:'foreign'},{reason:' '},{reason:'x'.repeat(850001)}]){const current=await state(f.shop);await assert.rejects(returned(f,purchase,1,body));assert.deepEqual(await state(f.shop),current)}
  for(const changed of [{transferParentId:'parent'},{costCorrectionId:'correction'},{transferChildren:[{id:'missing'}]}]){await table(f.shop,'pos_products').doc(f.product.id).update({transferParentId:null,costCorrectionId:null,transferChildren:[],...changed});const current=await state(f.shop);await assert.rejects(returned(f,purchase,1),{status:409});assert.deepEqual(await state(f.shop),current)}
})

test('Advanced supplier return retains real LOT/EXPIRY/SERIAL identities, source fractional serial returns and receipt evidence while physical checkout cannot oversell',async()=>{
  for(const trackingMode of ['LOT','EXPIRY','SERIAL']){
    const f=await fixture(undefined,{trackingMode:trackingMode==='EXPIRY'?'LOT':trackingMode,...(trackingMode==='EXPIRY'?{capabilities:{'inventory.expiry':true}}:{})}),serials=[{serial:randomUUID()},{serial:randomUUID()},{serial:randomUUID()}],receiptExtra=trackingMode==='SERIAL'?{serials}:{lot:{lotNumber:randomUUID(),expiresAt:'2035-01-01'}}
    const purchase=await received(f,3,100,{},receiptExtra),before=await state(f.shop),quantity=trackingMode==='SERIAL'?0.5:1
    const result=await returned(f,purchase,quantity);assert.equal(result.purchase.total,300-quantity*100);assert.equal(result.purchase.receipts[0].inventoryBatch.baseQuantity,String(3-quantity));assert.equal(result.purchase.items[0].receivedBaseQuantity,String(3-quantity))
    assert.deepEqual(await rows(f.shop,'pos_inventory_lots'),before.pos_inventory_lots);assert.deepEqual(await rows(f.shop,'pos_inventory_serials'),before.pos_inventory_serials);assert.deepEqual(await rows(f.shop,'pos_purchase_receipts'),before.pos_purchase_receipts)
    const choices=trackingMode==='SERIAL'?{serialIds:before.pos_inventory_serials.slice(0,2).map(row=>row[0])}:{}
    await sale(f,2,choices);const remaining=await state(f.shop),lastSerial=before.pos_inventory_serials.find(row=>!choices.serialIds?.includes(row[0]))
    await assert.rejects(sale(f,1,trackingMode==='SERIAL'?{serialIds:[lastSerial[0]]}:{}));assert.deepEqual(await state(f.shop),remaining)
    assert.deepEqual(await rows(f.shop,'pos_purchase_receipts'),before.pos_purchase_receipts)
  }
})

test('Advanced corrected purchases/returns weight actual remaining stock using current batch cost and freeze original supplier/POS cash and receipt movements',async()=>{
  const f=await fixture(),first=await received(f,5);await purchases.pay(f.shop,first.id,cash(50),'demo-owner',randomUUID());await sale(f,1)
  const before=await state(f.shop),current=(await catalog.get(f.shop,f.product.id)).product,groups=(await catalog.history(f.shop,f.product.id,'cost-groups')).groups
  await catalog.update(f.shop,f.product.id,{cost:200,expectedVersion:current.version,costCorrection:{mode:'ALL',reason:'Correct entered cost',expectedBatches:groups.map(row=>({id:row.id,unitCost:row.unitCost}))}},'demo-owner',randomUUID())
  const second=await received(f,3,300);assert.equal(second.items[0].product.cost,243)
  const result=await returned(f,first,1);assert.equal(result.purchase.returns[0].amount,200);assert.equal(result.purchase.total,300);assert.equal(result.purchase.paidAmount,50);assert.equal(result.purchase.items[0].product.cost,250);assert.equal((await catalog.get(f.shop,f.product.id)).product.cost,250)
  const now=await state(f.shop);for(const name of ['pos_purchase_payments','pos_purchase_payment_reversals','pos_payments'])assert.deepEqual(now[name],before[name])
  for(const name of ['stock_movements','pos_purchase_receipts']){const saved=new Map(now[name]);for(const [id,row]of before[name])assert.deepEqual(saved.get(id),row)}
  const invoice=(await pos.get(f.shop,before.pos_orders[0][0])).order;assert.equal(invoice.items[0].unitCost,200);assert.equal(invoice.total,500)
  const reloaded=(await purchases.list(f.shop,{pageSize:100})).purchases.find(row=>row.id===first.id);assert.equal(reloaded.total,300);assert.equal(reloaded.items[0].product.cost,250)
})

test('Advanced real parent transfers permit purchases and weight physical stock; supplier return retains child basis and rejects direct child receipt without partial changes',async()=>{
  const f=await fixture(),first=await received(f,3),transfers=createPosProductTransfers({db,ownerUid:'demo-owner'}),input={quantity:1,conversionFactor:2,newChild:{name:'Returned parent child '+randomUUID(),unitName:'Child piece',price:250}}
  const {preview}=await transfers.preview(f.shop,f.product.id,input,'demo-owner'),converted=await transfers.execute(f.shop,f.product.id,{...input,expectedFingerprint:preview.fingerprint},'demo-owner',randomUUID())
  await sale(f,1);const childBefore=(await rows(f.shop,'stock_batches')).filter(row=>row[1].productId===converted.product.id),transfersBefore=await rows(f.shop,'pos_product_transfer_allocations')
  const next=await received(f,3,300);assert.equal(next.items[0].product.cost,250)
  const result=await returned(f,first,1);assert.equal(result.purchase.total,200);assert.equal(result.purchase.items[0].product.cost,300);assert.deepEqual((await rows(f.shop,'stock_batches')).filter(row=>row[1].productId===converted.product.id),childBefore);assert.deepEqual(await rows(f.shop,'pos_product_transfer_allocations'),transfersBefore)
  const made=(await purchases.create(f.shop,{supplierId:f.supplier.id,items:[{productId:converted.product.id,quantity:1,unitCost:50}]},'demo-owner',randomUUID())).purchase;await purchases.send(f.shop,made.id,'demo-owner');const before=await state(f.shop)
  await assert.rejects(purchases.receive(f.shop,made.id,{items:[{purchaseItemId:made.items[0].id,quantity:1}]},'demo-owner',randomUUID()),error=>error.status===400&&error.message.includes('parent Transfer'));assert.deepEqual(await state(f.shop),before)
  const childSale=await sale({...f,product:converted.product},2);assert.equal(childSale.order.items[0].costValue,'100');assert.equal(childSale.order.total,500)
})

test('Advanced receipt return spans actual physical sites, freezes disabled source ledger, preserves original logical receipt IDs and reloads without duplicate movements',async()=>{
  const f=await fixture(),purchase=await received(f,4),batch=purchase.receipts[0].inventoryBatch,location=(await locations.create(f.shop,{name:'Return split shelf'})).location,moves=createPosInventoryTransfers({db}),scope=stockScopeKey(f.product.id,null,batch.locationId),balance=(await table(f.shop,'stock_balances').doc(scope).get()).data()
  await moves.transfer(f.shop,{sourceBalanceId:scope,expectedVersion:balance.version,targetLocationId:location.id,quantity:3,reason:'Physical shelf split'},'demo-owner',randomUUID())
  await table(f.shop,'pos_settings').doc('main').set({ledgerEnabled:false},{merge:true});const before=await state(f.shop),key=randomUUID(),result=await returned(f,purchase,3,{},key)
  assert.equal(result.purchase.total,100);assert.equal(result.purchase.receipts[0].inventoryBatch.id,batch.id);assert.equal(result.purchase.receipts[0].inventoryBatch.baseQuantity,'1');assert.equal(result.purchase.receipts[0].inventoryBatch.physicalBaseQuantity,'1')
  assert.deepEqual(await rows(f.shop,'pos_purchase_receipts'),before.pos_purchase_receipts)
  const current=new Map(await rows(f.shop,'stock_balances'));for(const [id,row]of before.stock_balances){assert.deepEqual(current.get(id).sourceLedger??{onHand:current.get(id).onHand,reserved:current.get(id).reserved,version:current.get(id).version,updatedAt:current.get(id).updatedAt},row.sourceLedger??{onHand:row.onHand,reserved:row.reserved,version:row.version,updatedAt:row.updatedAt})}
  const out=(await rows(f.shop,'stock_movements')).map(row=>row[1]).filter(row=>row.type==='SUPPLIER_RETURN');assert.equal(out.length,1);assert.equal(out[0].sourceLedgerVisible,false);assert.equal(out[0].physicalSlices.reduce((sum,row)=>sum+Number(row.baseQuantity),0),3);assert.equal(new Set(out[0].physicalSlices.map(row=>row.locationId)).size,2)
  const after=await state(f.shop);assert.deepEqual(await returned(f,purchase,3,{},key),result);assert.deepEqual(await state(f.shop),after)
  const reloaded=(await purchases.list(f.shop,{pageSize:100})).purchases[0];assert.equal(reloaded.receipts[0].inventoryBatch.baseQuantity,'1');await sale(f,1);const final=await state(f.shop);await assert.rejects(returned(f,purchase,1),{status:400});assert.deepEqual(await state(f.shop),final)
})

test('Same-key and distinct-key return races, payment and receive contenders conserve current parent finance and original receipt quantities',async()=>{
  const f=await fixture(),purchase=await received(f,2),key=randomUUID(),retry=await Promise.all(Array.from({length:3},()=>returned(f,purchase,1,{},key)));assert.ok(retry.every(row=>row.purchase.total===100));assert.equal((await rows(f.shop,'pos_purchase_returns')).length,1)
  const race=await Promise.allSettled([returned(f,purchase,1),returned(f,purchase,1)]);assert.equal(race.filter(row=>row.status==='fulfilled').length,1);assert.equal(race.find(row=>row.status==='rejected').reason.status,400);assert.equal((await catalog.get(f.shop,f.product.id)).product.cost,0)
  for(let round=0;round<2;round++){const fresh=await fixture(),p=await received(fresh,2),race=await Promise.allSettled([returned(fresh,p,1),purchases.pay(fresh.shop,p.id,cash(200),'demo-owner',randomUUID())]);assert.equal(race.filter(row=>row.status==='fulfilled').length,1);const saved=(await purchases.list(fresh.shop)).purchases[0];assert.ok(saved.paidAmount<=saved.total);assert.ok(saved.total===100&&saved.paidAmount===0||saved.total===200&&saved.paidAmount===200)}
  const fresh=await fixture(),created=(await purchases.create(fresh.shop,{supplierId:fresh.supplier.id,items:[{productId:fresh.product.id,quantity:3,unitCost:100}]},'demo-owner',randomUUID())).purchase;await purchases.send(fresh.shop,created.id,'demo-owner');const partial=(await purchases.receive(fresh.shop,created.id,{items:[{purchaseItemId:created.items[0].id,quantity:2}]},'demo-owner',randomUUID())).purchase
  const both=await Promise.allSettled([returned(fresh,partial,1),purchases.receive(fresh.shop,created.id,{items:[{purchaseItemId:created.items[0].id,quantity:1}]},'demo-owner',randomUUID())]);assert.ok(both.some(row=>row.status==='fulfilled'));const saved=(await purchases.list(fresh.shop)).purchases[0];assert.equal(saved.total,200);assert.equal(saved.items[0].receivedBaseQuantity,both.filter(row=>row.status==='fulfilled').length===2?'2':'1');assert.equal(saved.returns.length,1)
})

test('Return and real POS checkout race cannot remove the same last physical piece',async()=>{
  for(let round=0;round<3;round++){const f=await fixture(),purchase=await received(f,1),before=await rows(f.shop,'pos_purchase_receipts'),race=await Promise.allSettled([returned(f,purchase,1),pos.create(f.shop,{saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{method:'Cash',amount:500},items:[{productId:f.product.id,quantity:1}]},'demo-owner',randomUUID(),{checkout:true})]);assert.equal(race.filter(row=>row.status==='fulfilled').length,1);const balance=(await rows(f.shop,'stock_balances'))[0][1];assert.equal(balance.onHand,'0');assert.equal(balance.reserved,'0');assert.deepEqual(await rows(f.shop,'pos_purchase_receipts'),before)}
})

test('Actual public holds contend with supplier returns on bound received stock and retries leave guest/private and original payment evidence intact',async()=>{
  const f=await fixture(),stock=createShopStock({db}),publicOrders=createOrderService({db,checkoutEnabled:true}),purchase=await received(f,2)
  const published=normalizeProduct({name:'Public return product',slug:'return-'+randomUUID(),status:'published',variants:[{sku:randomUUID(),color:'Brown',size:'1',price:500,active:true}]},null,f.shop)
  await table(f.shop,'products').doc(published.id).set(published);await stock.bind(f.shop,{public_product_id:published.id,public_variant_id:published.variants[0].id,pos_product_id:f.product.id},'demo-owner')
  const input={request_key:randomUUID(),tracking_token:'a'.repeat(64),customer:{name:'Public buyer',phone:'099123456',city:'Yangon',address:'Private address'},items:[{variant_id:published.variants[0].id,quantity:1}]}
  const race=await Promise.allSettled([publicOrders.checkout(f.shop,input),returned(f,purchase,2)]);assert.equal(race.filter(row=>row.status==='fulfilled').length,1)
  const balance=(await rows(f.shop,'stock_balances'))[0][1]
  if(race[0].status==='fulfilled'){
    assert.equal(balance.onHand,'2');assert.equal(balance.reserved,'1');const hold=await rows(f.shop,'stock_reservations'),guestOrders=await rows(f.shop,'orders'),original=await rows(f.shop,'pos_purchase_receipts')
    const first=await returned(f,purchase,1),key=randomUUID();assert.equal(first.purchase.total,100);const after=await state(f.shop);await assert.rejects(returned(f,purchase,1,{},key),{status:400});assert.deepEqual(await state(f.shop),after);assert.deepEqual(await rows(f.shop,'stock_reservations'),hold);assert.deepEqual(await rows(f.shop,'orders'),guestOrders);assert.deepEqual(await rows(f.shop,'pos_purchase_receipts'),original)
  }else{assert.equal(balance.onHand,'0');assert.equal(balance.reserved,'0');assert.equal((await rows(f.shop,'pos_purchase_returns')).length,1);assert.equal((await rows(f.shop,'orders')).length,0)}
  // Verify an existing public hold unconditionally, regardless of race winner.
  const held=await fixture(),heldPurchase=await received(held,2),heldPublic=normalizeProduct({name:'Held return product',slug:'held-return-'+randomUUID(),status:'published',variants:[{sku:randomUUID(),color:'Brown',size:'1',price:500,active:true}]},null,held.shop)
  await table(held.shop,'products').doc(heldPublic.id).set(heldPublic);await stock.bind(held.shop,{public_product_id:heldPublic.id,public_variant_id:heldPublic.variants[0].id,pos_product_id:held.product.id},'demo-owner')
  await publicOrders.checkout(held.shop,{...input,request_key:randomUUID(),items:[{variant_id:heldPublic.variants[0].id,quantity:1}]})
  const originalGuest=await rows(held.shop,'orders'),originalHolds=await rows(held.shop,'stock_reservations'),before=await state(held.shop)
  await assert.rejects(returned(held,heldPurchase,2),{status:400});assert.deepEqual(await state(held.shop),before)
  await returned(held,heldPurchase,1);assert.deepEqual(await rows(held.shop,'orders'),originalGuest);assert.deepEqual(await rows(held.shop,'stock_reservations'),originalHolds)
  const heldBalance=(await rows(held.shop,'stock_balances'))[0][1];assert.equal(heldBalance.onHand,'1');assert.equal(heldBalance.reserved,'1')
})
