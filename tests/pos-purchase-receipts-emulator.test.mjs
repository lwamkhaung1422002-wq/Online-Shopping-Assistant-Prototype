import {releasePosCapabilities} from './pos-release-fixture.mjs'
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
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Purchase receiving requires isolated loopback Firebase emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url)),{initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
initializeApp({projectId:'demo-belle-online'});const db=getFirestore(),auth=getAuth(),purchases=createPosPurchases({db}),catalog=createPosCatalog({db}),locations=createPosLocations({db}),ledger=createStockLedger({db}),pos=createPosOrders({db})
const table=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`),rows=async(shop,name)=>(await table(shop,name).get()).docs.map(row=>[row.id,row.data()])
const tables=['pos_purchases','pos_purchase_receipts','pos_purchase_payments','pos_purchase_payment_reversals','pos_products','pos_locations','pos_location_locks','pos_inventory_lots','pos_inventory_serials','pos_inventory_locks','stock_batches','stock_balances','stock_movements','stock_reservations','stock_requests','pos_requests','pos_audit','pos_catalog_locks']
const state=async shop=>Object.fromEntries(await Promise.all(tables.map(async name=>[name,await rows(shop,name)])))
const cash=amount=>({amount,method:'Cash',signatureDataUrl:signatureFixture()})
async function product(shop,extra={}){return catalog.create(shop,{name:'Receive product '+randomUUID(),cost:100,price:500,units:[{name:'Piece',isBase:true,conversionFactor:1}],...extra},'demo-owner',randomUUID())}
async function fixture(shop='purchase-receive-'+randomUUID(),extra={}){
  const supplier={id:randomUUID(),shopId:shop,name:'Receive supplier '+randomUUID(),isActive:true,phone:'0999999',createdAt:'2026-10-01',updatedAt:'2026-10-01'}
  await table(shop,'pos_suppliers').doc(supplier.id).set(supplier)
  return {shop,supplier,product:await product(shop,extra)}
}
async function ordered(f,items=[{productId:f.product.id,quantity:2,unitCost:100}],extra={}){const created=await purchases.create(f.shop,{supplierId:f.supplier.id,items,...extra},'demo-owner',randomUUID());return (await purchases.send(f.shop,created.purchase.id,'demo-owner')).purchase}
const receive=(f,purchase,items,extra={},key=randomUUID())=>purchases.receive(f.shop,purchase.id,{items,...extra},'demo-owner',key)
const selected=(purchase,quantity,extra={},index=0)=>({purchaseItemId:purchase.items[index].id,quantity,...extra})
async function token(uid,email){try{await auth.createUser({uid,email,password:'Local-test-only-123!'})}catch(error){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(error.code))throw error}const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});assert.equal(response.status,200);return (await response.json()).idToken}
const api='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
async function http(path,owner,body,key){const response=await fetch(api+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer '+owner}:{}),...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()}}

test('Owner Purchase Receive HTTP atomically adds real stock, preserves source date/audit and returns current DTO on changed-payload retry without touching nine legacy collections',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example'),f=await fixture('belle-online'),purchase=await ordered(f),path='purchases/'+purchase.id+'/receive',key=randomUUID(),input={items:[selected(purchase,2)],receivedAt:'2026-10-04',note:' Original receiving note ',actorId:'forged'}
  const legacyId='receive-legacy-'+randomUUID(),names=['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta'],original={status:'reserved',paymentStatus:'unpaid',total:34500}
  for(const name of names)await db.doc(`users/demo-owner/${name}/${legacyId}`).set(original)
  const before=await state(f.shop)
  assert.equal((await http(path,undefined,input,key)).status,401);assert.equal((await http(path,other,input,key)).status,403)
  assert.deepEqual(await state(f.shop),before)
  const first=await http(path,owner,input,key);assert.equal(first.status,200);assert.equal(first.data.duplicate,false)
  const saved=first.data.purchase;assert.equal(saved.status,'received');assert.equal(saved.receivedAt,'2026-10-04T00:00:00.000Z');assert.equal(saved.items[0].receivedBaseQuantity,'2');assert.equal(saved.items[0].receivedQuantity,2)
  const receipt=saved.receipts[0];assert.equal(receipt.idempotencyKey,key);assert.equal(receipt.note,'Original receiving note');assert.equal(receipt.inventoryBatch.baseQuantity,'2');assert.equal(receipt.inventoryBatch.note,'Received from '+purchase.purchaseNumber);assert.equal(receipt.receivedAt,saved.receivedAt)
  const movement=(await rows(f.shop,'stock_movements')).map(row=>row[1]).find(row=>row.sourceId===receipt.id)
  assert.equal(movement.type,'PURCHASE_RECEIPT');assert.equal(movement.sourceType,'PurchaseReceipt');assert.equal(movement.actorUid,'demo-owner');assert.equal(movement.idempotencyKey,key+':'+purchase.items[0].id);assert.equal(movement.enteredQuantity,'2');assert.equal(movement.conversionFactor,'1');assert.equal(movement.averageCostAfter,100)
  const audit=(await rows(f.shop,'pos_audit')).map(row=>row[1]).find(row=>row.action==='purchase.receive'&&row.entityId===purchase.id)
  assert.equal(audit.actorId,'demo-owner');assert.deepEqual(audit.metadata,{items:input.items,note:'Original receiving note',receivedAt:saved.receivedAt})
  await purchases.pay(f.shop,purchase.id,cash(100),'demo-owner',randomUUID())
  const current=await state(f.shop),replay=await http(path,owner,{...input,items:[selected(purchase,999, {actualUnitCost:0})],note:'Different retry'},key)
  assert.equal(replay.status,200);assert.equal(replay.data.duplicate,true);assert.equal(replay.data.purchase.paidAmount,100);assert.equal(replay.data.purchase.receipts.length,1);assert.deepEqual(await state(f.shop),current)
  assert.deepEqual((await table(f.shop,'pos_purchase_receipts').doc(receipt.id).get()).data(),Object.fromEntries(Object.entries(receipt).filter(([key])=>key!=='inventoryBatch')))
  for(const name of names)assert.deepEqual((await db.doc(`users/demo-owner/${name}/${legacyId}`).get()).data(),original)
})

test('Real multi-item purchase receipts accumulate same-product/variant/location physical stock and sequential gross weighted cost while existing consumed and held batches stay immutable',async()=>{
  const f=await fixture(undefined,{openingStock:{quantity:3,unitCost:100},optionTree:{levels:[{id:'color',label:'Color'}],values:[{id:'brown',label:'Brown',level:0}]}}),p=f.product,a=(await locations.create(f.shop,{name:'A'})).location,b=(await locations.create(f.shop,{name:'B'})).location
  const variant=(await catalog.variants.save(f.shop,p.id,null,{optionPath:[{level:0,label:'Color',valueId:'brown',value:'Brown'}]},'demo-owner')).variant
  await pos.create(f.shop,{saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{method:'Cash',amount:500},items:[{productId:p.id,quantity:1}]},'demo-owner',randomUUID(),{checkout:true})
  await ledger.reservation(f.shop,{productId:p.id,sourceType:'Purchase-test',sourceId:'original-hold',quantity:1},'demo-owner',randomUUID())
  const originals=new Map(await rows(f.shop,'stock_batches')),oldMovements=new Map(await rows(f.shop,'stock_movements')),oldPayments=await rows(f.shop,'pos_payments')
  const purchase=await ordered(f,[{productId:p.id,quantity:2,unitCost:200},{productId:p.id,quantity:3,unitCost:300},{productId:p.id,quantity:4,unitCost:0},{productId:p.id,variantId:variant.id,quantity:2,unitCost:400}])
  const result=await receive(f,purchase,purchase.items.map((line,index)=>({purchaseItemId:line.id,quantity:line.enteredQuantity,locationId:index===2?b.id:a.id})))
  assert.equal(result.purchase.status,'received');assert.equal(result.purchase.total,2100);assert.equal(result.purchase.receipts.length,4)
  const movements=(await rows(f.shop,'stock_movements')).map(row=>row[1]);assert.deepEqual(result.purchase.receipts.map(receipt=>movements.find(row=>row.sourceId===receipt.id).averageCostAfter),[140,200,133,171]);assert.equal((await table(f.shop,'pos_products').doc(p.id).get()).data().cost,171)
  const balances=new Map(await rows(f.shop,'stock_balances'));assert.equal(balances.get(stockScopeKey(p.id,null,'main')).onHand,'2');assert.equal(balances.get(stockScopeKey(p.id,null,'main')).reserved,'1');assert.equal(balances.get(stockScopeKey(p.id,null,a.id)).onHand,'5');assert.equal(balances.get(stockScopeKey(p.id,null,a.id)).version,2);assert.equal(balances.get(stockScopeKey(p.id,null,b.id)).onHand,'4');assert.equal(balances.get(stockScopeKey(p.id,variant.id,a.id)).onHand,'2')
  const current=new Map(await rows(f.shop,'stock_batches'));for(const [key,value]of originals)assert.deepEqual(current.get(key),value)
  const currentMovements=new Map(await rows(f.shop,'stock_movements'));for(const [key,value]of oldMovements)assert.deepEqual(currentMovements.get(key),value);assert.deepEqual(await rows(f.shop,'pos_payments'),oldPayments)
})

test('Purchase actual-price confirmation retains original loaded batch cost, planned price and source payment-status behavior, and disabled ordered units remain receivable',async()=>{
  const f=await fixture(undefined,{units:[{name:'Piece',isBase:true,conversionFactor:1},{name:'Box',conversionFactor:6,canPurchase:true}]}),box=f.product.units.find(row=>!row.isBase)
  // Reference product creation defaults additional units to purchase-disabled.
  // Existing enabled purchase configuration is an explicit isolated fixture.
  await table(f.shop,'pos_products').doc(f.product.id).update({units:f.product.units.map(row=>row.id===box.id?{...row,canPurchase:true}:row)})
  const purchase=await ordered(f,[{productId:f.product.id,unitId:box.unitId,quantity:2,unitCost:1200}],{deliveryCost:500})
  await purchases.pay(f.shop,purchase.id,cash(2900),'demo-owner',randomUUID());const payment=await rows(f.shop,'pos_purchase_payments')
  // Current canPurchase does not override the existing ordered conversion.
  const stored=(await table(f.shop,'pos_products').doc(f.product.id).get()).data();await table(f.shop,'pos_products').doc(stored.id).update({isActive:false,units:stored.units.map(row=>row.unitId===box.unitId?{...row,canPurchase:false}:row)})
  const before=await state(f.shop);await assert.rejects(receive(f,purchase,[selected(purchase,1,{actualUnitCost:1000})]),/Confirm the price change/);assert.deepEqual(await state(f.shop),before)
  const first=await receive(f,purchase,[selected(purchase,1,{actualUnitCost:1000})],{confirmPriceChanges:true})
  assert.equal(first.purchase.status,'partially_received');assert.equal(first.purchase.receivedAt,null);assert.equal(first.purchase.total,2500);assert.equal(first.purchase.paidAmount,2900);assert.equal(first.purchase.paymentStatus,'paid');assert.equal(first.purchase.items[0].plannedUnitCost,1200);assert.equal(first.purchase.items[0].unitCost,1000);assert.equal(first.purchase.receipts[0].inventoryBatch.unitCost,200);assert.equal(first.purchase.receipts[0].baseQuantity,'6')
  const second=await receive(f,purchase,[selected(purchase,1)]);assert.equal(second.purchase.status,'received');assert.equal(second.purchase.receipts[1].inventoryBatch.unitCost,167);assert.equal(second.purchase.items[0].receivedBaseQuantity,'12');assert.equal((await table(f.shop,'pos_products').doc(f.product.id).get()).data().cost,184);assert.deepEqual(await rows(f.shop,'pos_purchase_payments'),payment)
})

test('Source last-duplicate selection, unknown-first retry and fractional compatibility increments are preserved through real transactions',async()=>{
  const f=await fixture(),purchase=await ordered(f,[{productId:f.product.id,quantity:0.8,unitCost:100}]),key=randomUUID()
  const first=await receive(f,purchase,[selected(purchase,0.1),selected(purchase,0.4)],{},key);assert.equal(first.purchase.items[0].receivedBaseQuantity,'0.4');assert.equal(first.purchase.items[0].receivedQuantity,0)
  const current=await state(f.shop);await assert.rejects(receive(f,purchase,[{purchaseItemId:'unknown',quantity:1},selected(purchase,0.4)],{},key),{status:409});assert.deepEqual(await state(f.shop),current)
  const unknown=await receive(f,purchase,[{purchaseItemId:'unknown',quantity:1}],{},randomUUID());assert.equal(unknown.purchase.status,'partially_received');assert.equal(unknown.purchase.receipts.length,1)
  const second=await receive(f,purchase,[selected(purchase,0.4)]);assert.equal(second.purchase.status,'received');assert.equal(second.purchase.items[0].receivedQuantity,0);assert.equal(second.purchase.items[0].receivedBaseQuantity,'0.8');assert.equal(second.purchase.receipts.length,2)
  const receipts=await rows(f.shop,'pos_purchase_receipts');assert.ok(receipts.every(row=>row[1].quantity===0));assert.equal((await rows(f.shop,'stock_balances'))[0][1].onHand,'0.8')
})

test('Late receiving validation, default-location collision, tracked input and oversized document failures leave every earlier stock/financial/location/audit write absent',async()=>{
  const f=await fixture(),purchase=await ordered(f,[{productId:f.product.id,quantity:2,unitCost:100},{productId:f.product.id,quantity:2,unitCost:100}]),before=await state(f.shop)
  for(const invalid of [{locationId:'foreign'},{quantity:3},{quantity:0.0001},{lot:{lotNumber:'unsupported'}},{serials:[{serial:'unexpected'}]}]){
    await assert.rejects(receive(f,purchase,[selected(purchase,1),selected(purchase,1,invalid,1)]),{status:400});assert.deepEqual(await state(f.shop),before)
  }
  await assert.rejects(receive(f,purchase,[selected(purchase,1)],{note:'x'.repeat(850001)}),{status:409});assert.deepEqual(await state(f.shop),before)
  const inactive=(await locations.create(f.shop,{name:'Main stock'})).location;await table(f.shop,'pos_locations').doc(inactive.id).update({isActive:false});const collision=await state(f.shop)
  await assert.rejects(receive(f,purchase,[selected(purchase,1)]),{status:409});assert.deepEqual(await state(f.shop),collision)
  const draft=(await purchases.create(f.shop,{supplierId:f.supplier.id,items:[{productId:f.product.id,quantity:1,unitCost:100}]},'demo-owner',randomUUID())).purchase
  await assert.rejects(receive(f,draft,[selected(draft,1)]),/not open/);await assert.rejects(purchases.receive(f.shop,randomUUID(),{items:[selected(purchase,1)]},'demo-owner'),{status:404})
})

test('Receipt keys and competing receive/payment/cancel operations serialize on the parent while real POS reservation shares the physical balance',async()=>{
  const f=await fixture(),purchase=await ordered(f),key=randomUUID(),input=[selected(purchase,2)]
  const retries=await Promise.all(Array.from({length:3},()=>receive(f,purchase,input,{},key)));assert.equal(retries.filter(row=>!row.duplicate).length,1);assert.ok(retries.every(row=>row.purchase.receipts.length===1))
  const second=await ordered(f),competing=await Promise.allSettled([receive(f,second,[selected(second,2)]),receive(f,second,[selected(second,2)])]);assert.equal(competing.filter(row=>row.status==='fulfilled').length,1);assert.equal(competing.find(row=>row.status==='rejected').reason.status,400)
  for(let round=0;round<2;round++){
    const next=await ordered(f),race=await Promise.allSettled([receive(f,next,[selected(next,2)]),purchases.cancel(f.shop,next.id,{reason:'Race',approver:'Owner'},'demo-owner')]);assert.equal(race.filter(row=>row.status==='fulfilled').length,1)
    const saved=(await purchases.list(f.shop,{search:next.purchaseNumber})).purchases[0];assert.ok(saved.status==='received'&&saved.receipts.length===1||saved.status==='cancelled'&&saved.receipts.length===0)
  }
  const next=await ordered(f),race=await Promise.all([receive(f,next,[selected(next,2)]),purchases.pay(f.shop,next.id,cash(100),'demo-owner',randomUUID())]);assert.equal(race.length,2)
  const final=(await purchases.list(f.shop,{search:next.purchaseNumber})).purchases[0];assert.equal(final.status,'received');assert.equal(final.paidAmount,100);assert.equal(final.paymentStatus,'partial')
  const hold=await ledger.reservation(f.shop,{productId:f.product.id,sourceType:'Purchase-test',sourceId:randomUUID(),quantity:1},'demo-owner',randomUUID()),last=await ordered(f)
  await Promise.all([receive(f,last,[selected(last,2)]),pos.create(f.shop,{saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{method:'Cash',amount:500},items:[{productId:f.product.id,quantity:1}]},'demo-owner',randomUUID(),{checkout:true})])
  assert.deepEqual((await table(f.shop,'stock_reservations').doc(hold.id).get()).data(),hold)
  const balances=(await rows(f.shop,'stock_balances')).map(row=>row[1]);assert.equal(balances.reduce((sum,row)=>sum+Number(row.reserved),0),1);assert.ok(balances.every(row=>Number(row.onHand)>=Number(row.reserved)))
})

test('Real LOT/expiry receipts require reasoned quarantine and transactionally unique shop numbers while leaving tracked reservations gated',async()=>{
  const f=await fixture();await releasePosCapabilities(db,f.shop,['inventory.lots','inventory.serials']);await table(f.shop,'pos_settings').doc('main').set({capabilities:{'inventory.lots':true,'inventory.serials':true}})
  const p=await product(f.shop,{trackingMode:'LOT',capabilities:{'inventory.expiry':true}}),tracked={...f,product:p},purchase=await ordered(tracked),q=(await locations.create(f.shop,{name:'Quarantine',type:'QUARANTINE'})).location
  const valid=selected(purchase,2,{locationId:q.id,lot:{lotNumber:' EXP-A ',expiresAt:'2026-01-01'}}),before=await state(f.shop)
  for(const input of [selected(purchase,2),selected(purchase,2,{lot:{lotNumber:'missing-expiry'}}),{...valid,locationId:undefined}]){await assert.rejects(receive(f,purchase,[input],{note:'Expired supply'}),{status:400});assert.deepEqual(await state(f.shop),before)}
  await assert.rejects(receive(f,purchase,[valid]),/reason note/);assert.deepEqual(await state(f.shop),before)
  const result=await receive(f,purchase,[valid],{note:' Expired supply ',receivedAt:'2026-10-04'}),lot=(await rows(f.shop,'pos_inventory_lots'))[0][1],movement=(await rows(f.shop,'stock_movements'))[0][1]
  assert.equal(lot.lotNumber,'EXP-A');assert.equal(lot.locationId,q.id);assert.equal(lot.quantity,'2');assert.equal(lot.unitCost,100);assert.equal(lot.status,'ACTIVE');assert.equal(lot.receivedAt,lot.createdAt);assert.notEqual(lot.receivedAt,result.purchase.receivedAt);assert.equal(movement.lotId,lot.id);assert.equal(movement.reason,'Expired supply')
  assert.equal((await catalog.get(f.shop,p.id)).product.availableStock,0)
  await assert.rejects(ledger.reservation(f.shop,{productId:p.id,sourceType:'Purchase-test',sourceId:'tracked',quantity:1},'demo-owner',randomUUID()),{status:501})
  const other=await ordered(tracked),current=await state(f.shop);await assert.rejects(receive(f,other,[selected(other,2,{locationId:q.id,lot:{lotNumber:'EXP-A',expiresAt:'2026-01-01'}})],{note:'Repeated lot'}),{status:409});assert.deepEqual(await state(f.shop),current)
})

test('SERIAL receipts persist source rows without a batch foreign key and serialize serial/IMEI uniqueness, exact counts and late duplicate rollback',async()=>{
  const f=await fixture();await releasePosCapabilities(db,f.shop,['inventory.serials']);await table(f.shop,'pos_settings').doc('main').set({capabilities:{'inventory.serials':true}})
  const p=await product(f.shop,{trackingMode:'SERIAL'}),tracked={...f,product:p},purchase=await ordered(tracked),before=await state(f.shop)
  for(const serials of [undefined,[{serial:'one'}],[{serial:'same'},{serial:'same'}],[{serial:'one',imei:'same'},{serial:'two',imei:'same'}]]){
    await assert.rejects(receive(f,purchase,[selected(purchase,2,{serials})]));assert.deepEqual(await state(f.shop),before)
  }
  await receive(f,purchase,[selected(purchase,2,{serials:[{serial:' S-A ',imei:' I-A '},{serial:'S-B'}]})]);const serials=(await rows(f.shop,'pos_inventory_serials')).map(row=>row[1]);assert.deepEqual(serials.map(row=>row.serial).sort(),['S-A','S-B']);assert.ok(serials.every(row=>row.status==='IN_STOCK'&&row.soldAt===null&&row.inventoryBatchId===undefined));assert.equal(serials.find(row=>row.serial==='S-A').imei,'I-A');assert.equal(serials.find(row=>row.serial==='S-B').imei,null)
  const one=await ordered(tracked,[{productId:p.id,quantity:1,unitCost:100}]),two=await ordered(tracked,[{productId:p.id,quantity:1,unitCost:100}])
  const race=await Promise.allSettled([receive(f,one,[selected(one,1,{serials:[{serial:'S-C',imei:'I-C'}]})]),receive(f,two,[selected(two,1,{serials:[{serial:'S-D',imei:'I-C'}]})])]);assert.equal(race.filter(row=>row.status==='fulfilled').length,1);assert.equal(race.find(row=>row.status==='rejected').reason.status,409);assert.equal((await rows(f.shop,'pos_inventory_serials')).length,3)
  const final=new Map(await rows(f.shop,'pos_inventory_serials'));for(const serial of serials)assert.deepEqual(final.get(serial.id),serial)
})

test('Purchase rounded Int32 boundary is a real receive/read/reservation path while strict Stock In input remains bounded',async()=>{
  const f=await fixture(),purchase=await ordered(f,[{productId:f.product.id,quantity:'2147483647.499',unitCost:0}])
  const result=await receive(f,purchase,[selected(purchase,'2147483647.499')]);assert.equal(result.purchase.items[0].receivedQuantity,2147483647);assert.equal(result.purchase.receipts[0].inventoryBatch.baseQuantity,'2147483647.499');assert.equal(result.purchase.receipts[0].inventoryBatch.quantity,2147483647)
  assert.equal((await catalog.get(f.shop,f.product.id)).product.availableStock,2147483647.499)
  const hold=await ledger.reservation(f.shop,{productId:f.product.id,sourceType:'Purchase-test',sourceId:'large-bound',quantity:1},'demo-owner',randomUUID());assert.equal(hold.quantity,'1')
  const final=(await rows(f.shop,'stock_balances'))[0][1];assert.equal(final.onHand,'2147483647.499');assert.equal(final.reserved,'1')
  await assert.rejects(ledger.receive(f.shop,{productId:f.product.id,quantity:'2147483647.499',unitCost:1},'demo-owner',randomUUID()),{status:400})
})

test('Actual purchase receiving supplies bound public checkout and competing POS stock authority, rejecting excess quantity without changing the immutable receipt',async()=>{
  const f=await fixture(),stock=createShopStock({db}),publicOrders=createOrderService({db,checkoutEnabled:true})
  const published=normalizeProduct({name:'Public received product',slug:'purchase-'+randomUUID(),status:'published',variants:[{sku:randomUUID(),color:'Brown',size:'1',price:500,active:true}]},null,f.shop)
  await table(f.shop,'products').doc(published.id).set(published);await stock.bind(f.shop,{public_product_id:published.id,public_variant_id:published.variants[0].id,pos_product_id:f.product.id},'demo-owner')
  const input=quantity=>({request_key:randomUUID(),tracking_token:'a'.repeat(64),customer:{name:'Public receipt buyer',phone:'099123456',city:'Yangon',address:'Private address'},items:[{variant_id:published.variants[0].id,quantity}]})
  await assert.rejects(publicOrders.checkout(f.shop,input(1)),{status:409})
  const purchase=await ordered(f),received=await receive(f,purchase,[selected(purchase,2)]),receipts=await rows(f.shop,'pos_purchase_receipts'),movements=await rows(f.shop,'stock_movements')
  assert.equal(received.purchase.status,'received');await assert.rejects(publicOrders.checkout(f.shop,input(3)),{status:409});assert.deepEqual(await rows(f.shop,'pos_purchase_receipts'),receipts)
  const race=await Promise.allSettled([publicOrders.checkout(f.shop,input(1)),pos.create(f.shop,{saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{method:'Cash',amount:1000},items:[{productId:f.product.id,quantity:2}]},'demo-owner',randomUUID(),{checkout:true})])
  assert.equal(race.filter(row=>row.status==='fulfilled').length,1);const shortage=race.find(row=>row.status==='rejected').reason;assert.ok([400,409].includes(shortage.status));assert.match(shortage.message,/short by|available stock|available inventory/)
  const balances=(await rows(f.shop,'stock_balances')).map(row=>row[1]);assert.ok(balances.every(row=>Number(row.onHand)>=Number(row.reserved)));assert.deepEqual(await rows(f.shop,'pos_purchase_receipts'),receipts)
  const guestWon=race[0].status==='fulfilled';assert.equal(balances.reduce((sum,row)=>sum+Number(row.onHand),0),guestWon?2:0);assert.equal(balances.reduce((sum,row)=>sum+Number(row.reserved),0),guestWon?1:0);assert.equal((await rows(f.shop,'orders')).length,guestWon?1:0);assert.equal((await rows(f.shop,'pos_orders')).length,guestWon?0:1)
  const after=new Map(await rows(f.shop,'stock_movements'));for(const [key,value]of movements)assert.deepEqual(after.get(key),value)
})
