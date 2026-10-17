import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {createStockLedger,stockScopeKey} from '../../BelleLocal POS app/functions/src/pos/stock-ledger.js'
import {createPosLocations} from '../../BelleLocal POS app/functions/src/pos/locations.js'
import {createPosCatalog} from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import {createPosOrders} from '../../BelleLocal POS app/functions/src/pos/orders.js'
import {createPosCancellation} from '../../BelleLocal POS app/functions/src/pos/cancellation.js'
import {createShopStock} from '../../BelleLocal POS app/functions/src/online-shop/stock.js'
import {createOrderService} from '../../BelleLocal POS app/functions/src/online-shop/orders.js'
import {normalizeProduct} from '../../BelleLocal POS app/functions/src/online-shop/domain.js'
import {runPosTransaction} from '../../BelleLocal POS app/functions/src/pos/transaction.js'

if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Scoped stock acceptance requires isolated loopback Firebase emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url)),{initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
initializeApp({projectId:'demo-belle-online'});const db=getFirestore(),auth=getAuth(),ledger=createStockLedger({db}),locations=createPosLocations({db}),catalog=createPosCatalog({db}),pos=createPosOrders({db}),cancel=createPosCancellation({db}),stock=createShopStock({db}),publicOrders=createOrderService({db,checkoutEnabled:true})
const table=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`),rows=async(shop,name)=>(await table(shop,name).get()).docs.map(row=>[row.id,row.data()]),stockTables=['pos_products','pos_units','pos_locations','stock_batches','stock_balances','stock_movements','stock_reservations','stock_requests','pos_orders','pos_payments','pos_requests','pos_audit']
async function state(shop){return Object.fromEntries(await Promise.all(stockTables.map(async name=>[name,await rows(shop,name)])))}
async function product(shop,opening=0){return catalog.create(shop,{name:'Scoped product '+randomUUID(),price:500,cost:100,units:[{name:'Piece',isBase:true,conversionFactor:1}],...(opening?{openingStock:{quantity:opening,unitCost:100}}:{})},'demo-owner',randomUUID())}
async function location(shop,name,type='SELLABLE'){return (await locations.create(shop,{name,type})).location}
async function receive(shop,product,location,quantity,unitCost=100,extra={},key=randomUUID()){return ledger.receiveScoped(shop,{productId:product.id,unitId:product.units.find(unit=>unit.isBase).unitId,locationId:location.id,enteredQuantity:quantity,unitCost,...extra},'demo-owner',key)}
async function publish(shop,product){const value=normalizeProduct({name:'Public scoped product',slug:'scoped-'+randomUUID(),status:'published',variants:[{sku:'Public-'+randomUUID(),color:'Brown',size:'1',price:500,active:true}]},null,shop);await table(shop,'products').doc(value.id).set(value);await stock.bind(shop,{public_product_id:value.id,public_variant_id:value.variants[0].id,pos_product_id:product.id},'demo-owner');return value}
const publicRequest=(published,quantity)=>({request_key:randomUUID(),tracking_token:'a'.repeat(64),customer:{name:'Scoped buyer',phone:'099123456',city:'Yangon',address:'Private address'},items:[{variant_id:published.variants[0].id,quantity}]})
const checkout=(product,quantity)=>({saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{method:'Cash',amount:500*quantity},items:[{productId:product.id,quantity}]})
async function balance(shop,product,location='main'){return (await table(shop,'stock_balances').doc(stockScopeKey(product.id,null,location)).get()).data()}
const receiptLine=(product,location,quantity,unitCost,extra={})=>({body:{productId:product.id,quantity,unitCost,unitId:product.units.find(unit=>unit.isBase).unitId,...extra},requestKey:randomUUID(),options:{allowZeroCost:true,locationId:location.id,movement:{type:'PURCHASE_RECEIPT',sourceType:'PurchaseReceipt',sourceId:randomUUID()}}})

test('Coordinated receipt lines accumulate one physical balance and sequential weighted costs across locations and actual variants, preserving every immutable line on replay',async()=>{
  const shop='receipt-group-'+randomUUID(),p=await catalog.create(shop,{name:'Receipt group variants',price:500,cost:100,units:[{name:'Piece',isBase:true,conversionFactor:1}],openingStock:{quantity:1,unitCost:100},optionTree:{levels:[{id:'color',label:'Color'}],values:[{id:'brown',label:'Brown',level:0},{id:'black',label:'Black',level:0}]}},'demo-owner',randomUUID()),a=await location(shop,'A'),b=await location(shop,'B'),variants=[]
  for(const color of ['brown','black'])variants.push((await catalog.variants.save(shop,p.id,null,{optionPath:[{level:0,label:'Color',valueId:color,value:color}]},'demo-owner')).variant)
  const entries=[receiptLine(p,a,2,200),receiptLine(p,a,3,300),receiptLine(p,b,4,0),receiptLine(p,a,2,400,{variantId:variants[0].id}),receiptLine(p,b,1,500,{variantId:variants[1].id})]
  const result=await ledger.receiveReceiptGroup(shop,entries,'demo-owner')
  assert.deepEqual(result.map(row=>row.averageCost),[167,233,140,183,208]);assert.equal((await table(shop,'pos_products').doc(p.id).get()).data().cost,208)
  assert.equal((await balance(shop,p,a.id)).onHand,'5');assert.equal((await balance(shop,p,a.id)).version,2);assert.equal((await balance(shop,p,b.id)).onHand,'4');assert.equal((await rows(shop,'stock_balances')).length,5)
  assert.equal((await table(shop,'stock_balances').doc(stockScopeKey(p.id,variants[0].id,a.id)).get()).data().onHand,'2');assert.equal((await table(shop,'stock_balances').doc(stockScopeKey(p.id,variants[1].id,b.id)).get()).data().onHand,'1')
  const movements=new Map(await rows(shop,'stock_movements'));for(const [index,row]of result.entries()){const movement=movements.get(row.inventoryBatch.id);assert.equal(movement.averageCostAfter,result[index].averageCost);assert.equal(movement.sourceId,entries[index].options.movement.sourceId);assert.equal(movement.locationId,entries[index].options.locationId)}
  const before=await state(shop);assert.deepEqual(await ledger.receiveReceiptGroup(shop,entries,'demo-owner'),result);assert.deepEqual(await state(shop),before)
  const extra=receiptLine(p,a,1,100),partial=await ledger.receiveReceiptGroup(shop,[entries[0],extra],'demo-owner');assert.deepEqual(partial[0],result[0]);assert.equal(partial[1].averageCost,200);assert.equal((await balance(shop,p,a.id)).onHand,'6');assert.equal((await table(shop,'pos_products').doc(p.id).get()).data().cost,200)
  const after=new Map(await rows(shop,'stock_movements'));for(const [key,row]of movements)assert.deepEqual(after.get(key),row)
})

test('A failed final coordinated receipt line, conflicting or duplicate key and double application roll back all earlier stock plans',async()=>{
  const shop='receipt-group-rollback-'+randomUUID(),p=await product(shop,2),a=await location(shop,'A'),first=receiptLine(p,a,1,200),before=await state(shop)
  await assert.rejects(ledger.receiveReceiptGroup(shop,[first,receiptLine(p,{id:'unknown'},1,300)],'demo-owner'),/location requires reconciliation/);assert.deepEqual(await state(shop),before)
  await assert.rejects(ledger.receiveReceiptGroup(shop,[first,{...receiptLine(p,a,1,300),requestKey:first.requestKey}],'demo-owner'),/distinct receipt keys/);assert.deepEqual(await state(shop),before)
  await assert.rejects(runPosTransaction(db,async tx=>{const plan=await ledger.prepareReceiptGroup(tx,shop,[first,receiptLine(p,a,1,300)],'demo-owner');plan.apply();plan.apply()}),/cannot be applied twice/);assert.deepEqual(await state(shop),before)
  await ledger.receiveReceiptGroup(shop,[first],'demo-owner');const committed=await state(shop)
  await assert.rejects(ledger.receiveReceiptGroup(shop,[receiptLine(p,a,1,400),{...first,body:{...first.body,quantity:2}}],'demo-owner'),{status:409});assert.deepEqual(await state(shop),committed)
  const missing=receiptLine({...p,id:'foreign'},a,1,300);await assert.rejects(ledger.receiveReceiptGroup(shop,[receiptLine(p,a,1,200),missing],'demo-owner'),{status:404});assert.deepEqual(await state(shop),committed)
})

test('Concurrent coordinated receipt groups and an actual POS sale keep original holds, consumed counters and immutable evidence while conserving physical stock',async()=>{
  const shop='receipt-group-race-'+randomUUID(),p=await product(shop,3),a=await location(shop,'A'),held=await ledger.reservation(shop,{productId:p.id,sourceType:'PosOrder',sourceId:randomUUID(),quantity:1},'demo-owner',randomUUID()),originals=new Map(await rows(shop,'stock_movements'))
  const groups=Array.from({length:3},(_,index)=>[receiptLine(p,a,1,200+index*100),receiptLine(p,a,1,200+index*100)])
  const results=await Promise.all([...groups.map(entries=>ledger.receiveReceiptGroup(shop,entries,'demo-owner')),pos.create(shop,checkout(p,2),'demo-owner',randomUUID(),{checkout:true})]);assert.equal(results.length,4)
  assert.equal((await balance(shop,p)).onHand,'1');assert.equal((await balance(shop,p)).reserved,'1');assert.equal((await balance(shop,p,a.id)).onHand,'6');assert.equal((await balance(shop,p,a.id)).reserved,'0');assert.equal((await balance(shop,p,a.id)).version,6)
  assert.equal((await table(shop,'stock_reservations').doc(held.id).get()).data().status,'ACTIVE');assert.equal((await table(shop,'pos_products').doc(p.id).get()).data().cost,233)
  const movements=new Map(await rows(shop,'stock_movements'));for(const [key,row]of originals)assert.deepEqual(movements.get(key),row)
  const opening=(await rows(shop,'stock_batches')).find(([,row])=>row.locationId===undefined)[1];assert.equal(opening.baseQuantity,'3');assert.equal(opening.physicalBaseQuantity,'1');assert.equal(opening.heldBaseQuantity,'1');assert.equal(opening.consumedBaseQuantity,'2')
})

test('Physical receipt rows preserve the Main key and exclude quarantine, damaged and transit stock from POS/public availability',async()=>{
  const shop='stock-scopes-'+randomUUID(),p=await product(shop,1),a=await location(shop,'A'),b=await location(shop,'B'),quarantine=await location(shop,'Quarantine','QUARANTINE'),damaged=await location(shop,'Damaged','DAMAGED'),transit=await location(shop,'Transit','TRANSIT')
  await receive(shop,p,a,2,200);await receive(shop,p,b,1,300);await receive(shop,p,quarantine,10,0);await receive(shop,p,damaged,3);await receive(shop,p,transit,4)
  const published=await publish(shop,p),detail=await catalog.get(shop,p.id)
  assert.equal(detail.product.currentStock,21);assert.equal(detail.product.availableStock,4)
  const projected=(await stock.project(shop,[published]))[0].variants[0];assert.equal(projected.on_hand,'4');assert.equal(projected.reserved,'0');assert.equal(projected.available,4)
  assert.equal((await balance(shop,p)).onHand,'1');assert.equal((await balance(shop,p,a.id)).onHand,'2');assert.equal((await balance(shop,p,quarantine.id)).onHand,'10')
  assert.equal((await rows(shop,'stock_balances')).length,6)
  const report=await locations.balances(shop,{location:quarantine.id});assert.equal(report.totalCount,1);assert.equal(report.balances[0].available,10);assert.equal(report.balances[0].location.type,'QUARANTINE')
  // The owner balance report shows physical quarantined stock; it does not
  // advertise that row as sellable public stock.
  const source=(await catalog.movements(shop,{location:a.id})).movements;assert.equal(source.length,1);assert.equal(source[0].location.id,a.id);assert.equal(source[0].location.name,'A')
})

test('Scoped receipt foundation supports converted purchase units and zero cost, retains entered/base evidence and rolls back invalid input/reused keys',async()=>{
  const shop='scoped-units-'+randomUUID(),p=await catalog.create(shop,{name:'Converted scoped product',price:500,cost:100,units:[{name:'Piece',isBase:true,conversionFactor:1},{name:'Case',conversionFactor:6}]},'demo-owner',randomUUID()),a=await location(shop,'Receive')
  // Explicit existing-unit precondition: the source supports already-enabled
  // non-base purchase units. The configuration writer is not claimed here.
  const caseUnit=p.units.find(unit=>!unit.isBase);await table(shop,'pos_products').doc(p.id).update({units:p.units.map(({unit,...row})=>({...row,canPurchase:true}))})
  const body={productId:p.id,unitId:caseUnit.unitId,locationId:a.id,enteredQuantity:'0.5',unitCost:0,reason:'Converted free supply'},key=randomUUID(),received=await ledger.receiveScoped(shop,body,'demo-owner',key,{refreshCost:false})
  assert.equal(received.inventoryBatch.baseQuantity,'3');assert.equal(received.inventoryBatch.unitCost,0);assert.equal(received.inventoryBatch.unitSnapshot.conversionFactor,'1');assert.equal((await table(shop,'pos_products').doc(p.id).get()).data().cost,100)
  const movement=(await rows(shop,'stock_movements'))[0][1];assert.equal(movement.baseQuantity,'3');assert.equal(movement.enteredQuantity,'0.5');assert.equal(movement.conversionFactor,'6');assert.equal(movement.unitId,caseUnit.unitId);assert.equal(movement.unitSnapshot.productUnitId,caseUnit.id);assert.equal(movement.locationId,a.id)
  assert.deepEqual(await ledger.receiveScoped(shop,body,'demo-owner',key,{refreshCost:false}),received)
  const before=await state(shop)
  for(const input of [{...body,enteredQuantity:'0.5001'},{...body,unitId:'other'},{...body,locationId:'unknown'},{...body,unitCost:-1},{...body,lot:{lotNumber:'Unsupported'}},{...body,serials:[{serial:'Unsupported'}]}])await assert.rejects(ledger.receiveScoped(shop,input,'demo-owner',randomUUID()),error=>[400,409].includes(error.status))
  await assert.rejects(ledger.receiveScoped(shop,{...body,reason:'Changed'},'demo-owner',key,{refreshCost:false}),{status:409})
  assert.deepEqual(await state(shop),before)
  await table(shop,'pos_units').doc(caseUnit.unitId).update({precision:0});await assert.rejects(ledger.receiveScoped(shop,body,'demo-owner',randomUUID()),/at most 0 decimal/)
  const inactive=await location(shop,'Inactive');await table(shop,'pos_locations').doc(inactive.id).update({isActive:false});await assert.rejects(receive(shop,p,inactive,1),/active inventory location/)
  const snapshot=await state(shop)
  await assert.rejects(runPosTransaction(db,async tx=>{const first=await ledger.prepareScopedReceipt(tx,shop,{...body,enteredQuantity:1},'demo-owner',randomUUID());await ledger.prepareScopedReceipt(tx,shop,{...body,enteredQuantity:1},'demo-owner',randomUUID());first.apply()}),/coordinated purchase plan/)
  assert.deepEqual(await state(shop),snapshot)
})

test('Actual POS checkout consumes FIFO across sellable physical rows; cancellation restores each original location and leaves original sale/payment evidence immutable',async()=>{
  const shop='scoped-sale-'+randomUUID(),p=await product(shop,1),a=await location(shop,'A'),b=await location(shop,'B'),quarantine=await location(shop,'Quarantine','QUARANTINE')
  const one=await receive(shop,p,a,2,200),two=await receive(shop,p,b,1,300);await receive(shop,p,quarantine,10,0)
  const originalStock=await rows(shop,'stock_batches'),created=await pos.create(shop,checkout(p,4),'demo-owner',randomUUID(),{checkout:true}),order=created.order
  assert.equal(order.fulfillmentStatus,'completed');assert.equal(order.items[0].allocations.length,3);assert.equal(order.items[0].unitCost,200)
  for(const loc of ['main',a.id,b.id]){assert.equal((await balance(shop,p,loc)).onHand,'0');assert.equal((await balance(shop,p,loc)).reserved,'0')}
  assert.equal((await balance(shop,p,quarantine.id)).onHand,'10')
  const sales=(await rows(shop,'stock_movements')).filter(([,row])=>row.type==='SALE');assert.deepEqual(new Set(sales.map(([,row])=>row.locationId)),new Set(['main',a.id,b.id]))
  const payments=await rows(shop,'pos_payments');await cancel.cancel(shop,order.id,{reason:'Original-location restoration'},'demo-owner')
  assert.equal((await balance(shop,p)).onHand,'1');assert.equal((await balance(shop,p,a.id)).onHand,'2');assert.equal((await balance(shop,p,b.id)).onHand,'1');assert.equal((await balance(shop,p,quarantine.id)).onHand,'10')
  const movements=new Map(await rows(shop,'stock_movements'));for(const [key,row]of sales)assert.deepEqual(movements.get(key),row)
  const paymentRows=new Map(await rows(shop,'pos_payments'));for(const [key,row]of payments)assert.deepEqual(paymentRows.get(key),row)
  const restored=await rows(shop,'stock_batches');for(const [key,row]of originalStock){const current=restored.find(([id])=>id===key)[1];for(const field of ['physicalBaseQuantity','heldBaseQuantity','consumedBaseQuantity','baseQuantity','reservedBaseQuantity'])assert.equal(current[field],row[field])}
  assert.equal((await table(shop,'stock_batches').doc(one.inventoryBatch.id).get()).data().locationId,a.id);assert.equal((await table(shop,'stock_batches').doc(two.inventoryBatch.id).get()).data().locationId,b.id)
})

test('Concurrent actual public and POS checkout share the last sellable unit, never sell quarantine stock and keep all nine legacy collections untouched',async()=>{
  const originals={};for(const name of ['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta']){const target=db.doc(`users/demo-owner/${name}/scopes-${randomUUID()}`),value={source:name,amount:34500,status:'reserved',paymentStatus:'unpaid'};await target.set(value);originals[target.path]=value}
  for(let round=0;round<3;round++){
    const shop='scoped-race-'+randomUUID(),p=await product(shop),a=await location(shop,'Sellable'),q=await location(shop,'Quarantine','QUARANTINE');await receive(shop,p,a,1);await receive(shop,p,q,100,0);const published=await publish(shop,p),request=publicRequest(published,1)
    const attempts=await Promise.allSettled([publicOrders.checkout(shop,request),pos.create(shop,checkout(p,1),'demo-owner',randomUUID(),{checkout:true})])
    assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);for(const result of attempts.filter(result=>result.status==='rejected'))assert([400,409].includes(result.reason.status))
    assert.equal((await stock.project(shop,[published]))[0].variants[0].available,0);assert.equal((await balance(shop,p,q.id)).onHand,'100');assert.equal((await balance(shop,p,q.id)).reserved,'0')
    const before=await state(shop);await assert.rejects(pos.create(shop,checkout(p,1),'demo-owner',randomUUID(),{checkout:true}));await assert.rejects(publicOrders.checkout(shop,publicRequest(published,1)));assert.deepEqual(await state(shop),before)
    if(attempts[0].status==='fulfilled'){await publicOrders.transition(shop,request.request_key,{status:'cancelled'},'demo-owner');assert.equal((await balance(shop,p,a.id)).reserved,'0');assert.equal((await stock.project(shop,[published]))[0].variants[0].available,1)}
  }
  for(const [path,value]of Object.entries(originals))assert.deepEqual((await db.doc(path).get()).data(),value)
})

test('Public accept and actual POS handover transfer multi-location holds once, without changing any physical balance or batch; cancellation releases them once',async()=>{
  const shop='scoped-handover-'+randomUUID(),p=await product(shop,1),a=await location(shop,'Other sellable');await receive(shop,p,a,1,200);const published=await publish(shop,p),request=publicRequest(published,2)
  await publicOrders.checkout(shop,request);await publicOrders.transition(shop,request.request_key,{status:'confirmed'},'demo-owner')
  const balancesBefore=await rows(shop,'stock_balances'),batchesBefore=await rows(shop,'stock_batches'),key=randomUUID(),result=await pos.handover(shop,request.request_key,{paymentMode:'COD'},'demo-owner',key)
  assert.equal(result.order.items[0].allocations.length,2);assert.deepEqual(await rows(shop,'stock_batches'),batchesBefore)
  const after=new Map(await rows(shop,'stock_balances'));for(const [key,row]of balancesBefore){assert.equal(after.get(key).onHand,row.onHand);assert.equal(after.get(key).reserved,row.reserved);assert.equal(after.get(key).version,row.version+1)}
  assert.equal((await pos.handover(shop,request.request_key,{paymentMode:'COD'},'demo-owner',key)).order.id,result.order.id)
  await cancel.cancel(shop,result.order.id,{reason:'Release transferred holds'},'demo-owner')
  assert.equal((await balance(shop,p)).reserved,'0');assert.equal((await balance(shop,p,a.id)).reserved,'0');assert.equal((await stock.project(shop,[published]))[0].variants[0].available,2)
})

test('Unknown or mismatched physical scopes and held balances fail reconciliation with no partial reservation/receipt/cancellation write',async()=>{
  const shop='scoped-drift-'+randomUUID(),p=await product(shop),a=await location(shop,'A'),received=await receive(shop,p,a,2),target=table(shop,'stock_balances').doc(stockScopeKey(p.id,null,a.id))
  await target.update({reserved:'1'});let before=await state(shop);await assert.rejects(ledger.reservation(shop,{productId:p.id,sourceType:'PosOrder',sourceId:randomUUID(),quantity:1},'demo-owner',randomUUID()),/balance requires reconciliation/);assert.deepEqual(await state(shop),before)
  await target.update({reserved:'0'});const b=await location(shop,'B');await receive(shop,p,b,10);const published=await publish(shop,p)
  // A positive shop sum must never hide a negative individual location row.
  await target.update({reserved:'3'});before=await state(shop);await assert.rejects(stock.project(shop,[published]),/balance requires reconciliation/);assert.deepEqual(await state(shop),before)
  await target.update({reserved:'0'});await table(shop,'stock_batches').doc(received.inventoryBatch.id).update({locationId:'unknown'});before=await state(shop);await assert.rejects(receive(shop,p,a,1),/location requires reconciliation/);assert.deepEqual(await state(shop),before)
})

test('Actual variant producers keep product/variant/location scopes separate and a later variant shortage rolls back every earlier stock/invoice plan',async()=>{
  const shop='scoped-variants-'+randomUUID(),p=await catalog.create(shop,{name:'Scoped variants',price:500,cost:100,units:[{name:'Piece',isBase:true,conversionFactor:1}],optionTree:{levels:[{id:'color',label:'Color'}],values:[{id:'brown',label:'Brown',level:0},{id:'black',label:'Black',level:0}]}},'demo-owner',randomUUID()),a=await location(shop,'A'),b=await location(shop,'B'),q=await location(shop,'Quarantine','QUARANTINE')
  const variants=[];for(const color of ['brown','black'])variants.push((await catalog.variants.save(shop,p.id,null,{optionPath:[{level:0,label:'Color',valueId:color,value:color}]},'demo-owner')).variant)
  await receive(shop,p,a,2,100,{variantId:variants[0].id});await receive(shop,p,b,1,100,{variantId:variants[1].id});await receive(shop,p,q,99,0,{variantId:variants[0].id})
  const before=await state(shop),items=[{productId:p.id,variantId:variants[0].id,quantity:2},{productId:p.id,variantId:variants[1].id,quantity:2}]
  await assert.rejects(pos.create(shop,{saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{method:'Cash',amount:2000},items},'demo-owner',randomUUID(),{checkout:true}));assert.deepEqual(await state(shop),before)
  items[1].quantity=1;const result=await pos.create(shop,{saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{method:'Cash',amount:1500},items},'demo-owner',randomUUID(),{checkout:true})
  assert.equal(result.order.items.length,2);assert.equal((await table(shop,'stock_balances').doc(stockScopeKey(p.id,variants[0].id,a.id)).get()).data().onHand,'0');assert.equal((await table(shop,'stock_balances').doc(stockScopeKey(p.id,variants[1].id,b.id)).get()).data().onHand,'0');assert.equal((await table(shop,'stock_balances').doc(stockScopeKey(p.id,variants[0].id,q.id)).get()).data().onHand,'99')
  const sales=(await rows(shop,'stock_movements')).filter(([,row])=>row.type==='SALE').map(([,row])=>row);assert.equal(sales.length,2);assert(sales.some(row=>row.variantId===variants[0].id&&row.locationId===a.id));assert(sales.some(row=>row.variantId===variants[1].id&&row.locationId===b.id))
})

test('Owner-only balance HTTP follows source product/SKU/active barcode search, location filter, date paging, physical relations and read-only behavior',async()=>{
  async function token(uid,email){try{await auth.createUser({uid,email,password:'Local-test-only-123!'})}catch(error){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(error.code))throw error}const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});assert.equal(response.status,200);return (await response.json()).idToken}
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example'),base='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/inventory-balances'
  async function http(query='',identity=owner){const response=await fetch(base+query,{headers:identity?{Authorization:'Bearer '+identity}:{}});return {status:response.status,data:await response.json()}}
  assert.equal((await http('',null)).status,401);assert.equal((await http('',other)).status,403)
  const shop='belle-online',p=await product(shop),a=await location(shop,'HTTP scoped '+randomUUID());await receive(shop,p,a,2)
  const barcode='ScopedNorm'+randomUUID();await table(shop,'pos_barcodes').doc(randomUUID()).set({productId:p.id,value:'Stored display',normalizedValue:barcode,status:'ACTIVE'})
  const inactive='InactiveOnly'+randomUUID();await table(shop,'pos_barcodes').doc(randomUUID()).set({productId:p.id,value:inactive,normalizedValue:inactive,status:'RETIRED'})
  const found=await http('?search='+barcode.toLowerCase());assert.equal(found.status,200,JSON.stringify(found.data));assert.deepEqual(Object.keys(found.data).sort(),['balances','totalCount']);assert.equal(found.data.totalCount,1);assert.equal(found.data.balances[0].location.id,a.id);assert.equal(found.data.balances[0].product.id,p.id);assert.equal(found.data.balances[0].variant,null);assert.equal(found.data.balances[0].available,2)
  assert.equal((await http('?search='+inactive)).data.totalCount,0);assert.equal((await http('?search='+barcode+'&location=unknown')).data.totalCount,0)
  for(const query of ['?pageSize=10','?page=0','?direction=bad'])assert.equal((await http(query)).status,400)
  // Explicit zero-balance paging fixtures supplement the real receipt row;
  // these are reader inputs, not evidence for an opening/migration writer.
  const term='PagingScoped'+randomUUID(),batch=db.batch(),ids=[]
  for(let index=0;index<32;index++){const id=randomUUID();ids.push(id);batch.create(table(shop,'pos_products').doc(id),{id,shopId:shop,name:term+' '+index,sku:term+'SKU'+index,variants:[]});batch.create(table(shop,'stock_balances').doc(stockScopeKey(id)),{shopId:shop,productId:id,variantId:null,locationId:'main',onHand:'0',reserved:'0',version:1,updatedAt:new Date(Date.UTC(2026,1,index+1)).toISOString()})}
  await batch.commit();const before=await state(shop),first=await http('?search='+term+'&direction=asc&status=ignored'),second=await http('?search='+term+'&direction=asc&page=2'),reverse=await http('?search='+term+'&direction=desc')
  assert.equal(first.data.totalCount,32);assert.equal(first.data.balances.length,25);assert.equal(second.data.balances.length,7);assert.equal(first.data.balances[0].product.id,ids[0]);assert.equal(second.data.balances[6].product.id,ids[31]);assert.equal(reverse.data.balances[0].product.id,ids[31]);assert.equal((await http('?search='+term+'&page=99')).data.balances.length,0);assert.deepEqual(await state(shop),before)
})
