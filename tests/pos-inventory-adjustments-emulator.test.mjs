import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {createPosInventoryAdjustments} from '../../BelleLocal POS app/functions/src/pos/inventory-adjustments.js'
import {createPosCatalog} from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import {createPosLocations} from '../../BelleLocal POS app/functions/src/pos/locations.js'
import {createPosInventoryTransfers} from '../../BelleLocal POS app/functions/src/pos/inventory-transfers.js'
import {createPosOrders} from '../../BelleLocal POS app/functions/src/pos/orders.js'
import {createStockLedger,stockScopeKey} from '../../BelleLocal POS app/functions/src/pos/stock-ledger.js'
import {createShopStock} from '../../BelleLocal POS app/functions/src/online-shop/stock.js'
import {createOrderService} from '../../BelleLocal POS app/functions/src/online-shop/orders.js'
import {normalizeProduct} from '../../BelleLocal POS app/functions/src/online-shop/domain.js'
import {createServer} from 'node:http'
import {once} from 'node:events'
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Adjustments require isolated loopback emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url)),{initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
initializeApp({projectId:'demo-belle-online'});const db=getFirestore(),auth=getAuth(),adjustments=createPosInventoryAdjustments({db,ownerUid:'demo-owner'}),catalog=createPosCatalog({db}),ledger=createStockLedger({db}),pos=createPosOrders({db}),locations=createPosLocations({db}),transfers=createPosInventoryTransfers({db})
const table=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`),rows=async(shop,name)=>(await table(shop,name).get()).docs.map(row=>[row.id,row.data()]),names=['pos_products','pos_units','pos_locations','stock_batches','stock_balances','stock_movements','stock_reservations','pos_audit','pos_inventory_adjustments','pos_requests','pos_catalog_locks','pos_location_locks','pos_orders','pos_payments'],state=async shop=>Object.fromEntries(await Promise.all(names.map(async name=>[name,await rows(shop,name)])))
async function fixture(shop='adjust-'+randomUUID(),quantity=5){const product=await catalog.create(shop,{name:'Adjustment '+randomUUID(),price:500,cost:100,units:[{name:'Piece',isBase:true,conversionFactor:1}],openingStock:{quantity,unitCost:100}},'demo-owner',randomUUID());return {shop,product}}
const balance=async(f,location='main')=>({...((await table(f.shop,'stock_balances').doc(stockScopeKey(f.product.id,null,location)).get()).data()),id:stockScopeKey(f.product.id,null,location)}),body=(f,extra={})=>({balanceId:stockScopeKey(f.product.id),expectedVersion:1,action:'ADD',quantity:'2',reason:'Counted shelf stock',...extra}),checkout=(product,quantity)=>({saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{method:'Cash',amount:500*quantity},items:[{productId:product.id,quantity}]})
async function token(uid,email){try{await auth.createUser({uid,email,password:'Local-test-only-123!'})}catch(e){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(e.code))throw e}const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});assert.equal(r.status,200);return (await r.json()).idToken}
async function http(owner,input,key){const r=await fetch('http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/inventory-operations/adjust',{method:'POST',headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer '+owner}:{}),...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(input)});return {status:r.status,data:await r.json()}}

async function historyFixture(){
 const f=await fixture(),batch=(await table(f.shop,'stock_batches').get()).docs[0],variant={id:'saved-variant',name:'Brown',isActive:true}
 await table(f.shop,'pos_products').doc(f.product.id).update({variants:[variant]});await batch.ref.update({variantId:variant.id})
 const saved=(key,data)=>table(f.shop,'pos_stock_adjustments').doc(key).set({shopId:f.shop,productId:f.product.id,inventoryBatchId:batch.id,action:'SUB',quantity:1,beforeQuantity:5,afterQuantity:4,baseQuantity:'0.5',beforeBaseQuantity:'5',afterBaseQuantity:'4.5',reason:'Recorded count difference',staffName:'Saved original actor',createdAt:'2026-10-12T03:00:00.000Z',unitSnapshot:{name:'Piece',symbol:'pc',conversionFactor:'1'},...data})
 await saved('by-batch',{});await saved('by-cost',{inventoryBatchId:null,selectedUnitCost:100,createdAt:'2026-10-12T04:00:00.000Z'})
 const read=async()=>({...await state(f.shop),pos_stock_adjustments:await rows(f.shop,'pos_stock_adjustments')})
 return {...f,batch,variant,saved,read}
}

test('Stock adjustment history preserves saved quantities/staff/unit snapshot and current batch/product/variant joins with source ordering and no writes',async()=>{
 const f=await historyFixture(),before=await f.read(),result=await adjustments.history(f.shop,'demo-owner')
 assert.deepEqual(result.adjustments.map(row=>row.id),['by-cost','by-batch']);const grouped=result.adjustments[0],joined=result.adjustments[1]
 assert.equal(grouped.inventoryBatch,null);assert.equal(grouped.selectedUnitCost,100);assert.equal(joined.baseQuantity,'0.5');assert.equal(joined.quantity,1);assert.equal(joined.staffName,'Saved original actor');assert.equal(joined.unitSnapshot.symbol,'pc');assert.equal(joined.inventoryBatch.id,f.batch.id);assert.equal(joined.inventoryBatch.product.id,f.product.id);assert.equal(joined.inventoryBatch.variant.name,'Brown')
 await table(f.shop,'pos_products').doc(f.product.id).update({name:'Current renamed product',variants:[{...f.variant,name:'Current renamed variant'}]});const changed=await f.read(),current=await adjustments.history(f.shop,'demo-owner');assert.equal(current.adjustments[1].inventoryBatch.product.name,'Current renamed product');assert.equal(current.adjustments[1].inventoryBatch.variant.name,'Current renamed variant');assert.equal(current.adjustments[1].staffName,'Saved original actor');assert.deepEqual(await f.read(),changed);assert.deepEqual(new Map(changed.pos_stock_adjustments),new Map(before.pos_stock_adjustments))
 const empty=await fixture();assert.deepEqual(await adjustments.history(empty.shop,'demo-owner'),{adjustments:[]})
})

test('Stock adjustment history has no mutation fallback: orphan batch/product/variant/date evidence rejects without source repair and generic balance movements stay separate',async()=>{
 for(const kind of ['batch','product','variant','date','tenant']){
  const f=await historyFixture()
  if(kind==='batch')await f.batch.ref.delete();else if(kind==='product')await table(f.shop,'pos_products').doc(f.product.id).delete();else if(kind==='variant')await table(f.shop,'pos_products').doc(f.product.id).update({variants:[]});else await table(f.shop,'pos_stock_adjustments').doc('by-batch').update(kind==='date'?{createdAt:'invalid'}:{shopId:'different-shop'})
  const before=await f.read();await assert.rejects(adjustments.history(f.shop,'demo-owner'),error=>error.status===409);assert.deepEqual(await f.read(),before)
 }
 const f=await fixture();await adjustments.adjust(f.shop,body(f),'demo-owner',randomUUID());const before=await state(f.shop);assert.deepEqual(await adjustments.history(f.shop,'demo-owner'),{adjustments:[]});assert.equal(before.pos_inventory_adjustments.length,1);assert.deepEqual(await state(f.shop),before)
})

test('Stock adjustment history reads only its current owner/shop scope and leaves all original Belle evidence unchanged',async()=>{
 const f=await historyFixture(),uid='adjustment-original-'+randomUUID(),names=['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta'],original={status:'reserved',amount:34500,quantity:7}
 for(const name of names)await db.doc(`users/${uid}/${name}/original`).set(original)
 const own=createPosInventoryAdjustments({db,ownerUid:uid}),before=await f.read();assert.equal((await own.history(f.shop,uid)).adjustments.length,2);await assert.rejects(own.history(f.shop,'another-user'),error=>error.status===403);assert.deepEqual(await f.read(),before)
 const other=await historyFixture();assert.ok((await own.history(f.shop,uid)).adjustments.every(row=>row.shopId===f.shop));assert.ok((await own.history(other.shop,uid)).adjustments.every(row=>row.shopId===other.shop))
 for(const name of names)assert.deepEqual((await db.doc(`users/${uid}/${name}/original`).get()).data(),original)
})

test('Actual stock adjustment history API requires verified owner/current shop, returns saved joined evidence and rejects corrupt relations without writes',async()=>{
 const {createShopApi}=await import('../../BelleLocal POS app/functions/src/online-shop/api.js')
 const f=await historyFixture(),uid='adjustment-reader-'+randomUUID(),owner=await token(uid,uid+'@belle-demo.example'),otherId='adjustment-outsider-'+randomUUID(),other=await token(otherId,otherId+'@belle-demo.example'),handler=createShopApi({db,auth,ownerUid:uid,allowedShopId:f.shop})
 const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');req.path=url.pathname;req.query=Object.fromEntries(url.searchParams);res.set=(key,value)=>res.setHeader(key,value);res.status=value=>{res.statusCode=value;return res};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))};res.send=value=>res.end(value);await handler(req,res)})
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`,get=async(token,path=`/${f.shop}/admin/pos/inventory-adjustments`,method='GET')=>{const response=await fetch(base+path,{method,headers:token?{Authorization:'Bearer '+token}:{}});return{status:response.status,data:await response.json()}}
 try{const before=await f.read(),deletePath=`/${f.shop}/admin/pos/inventory/${f.batch.id}`;assert.equal((await get(null,deletePath,'DELETE')).status,401);assert.equal((await get(other,deletePath,'DELETE')).status,403);assert.equal((await get(owner,'/another-shop/admin/pos/inventory/unknown','DELETE')).status,404);for(const path of [deletePath,`/${f.shop}/admin/pos/inventory/unknown`]){const denied=await get(owner,path,'DELETE');assert.equal(denied.status,400);assert.match(denied.data.error,/Inventory records cannot be deleted/)}assert.deepEqual(await f.read(),before);assert.equal((await get(null)).status,401);assert.equal((await get(other)).status,403);assert.equal((await get(owner,'/another-shop/admin/pos/inventory-adjustments')).status,404);const result=await get(owner);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.adjustments.length,2);assert.equal(result.data.adjustments[1].inventoryBatch.variant.name,'Brown');assert.deepEqual(await f.read(),before);await f.batch.ref.delete();const corrupt=await f.read(),invalid=await get(owner);assert.equal(invalid.status,409);assert.equal(invalid.data.adjustments,undefined);assert.deepEqual(await f.read(),corrupt)}finally{await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections()})}
})

test('Real owner adjustment HTTP preserves source frozen 201 replay, direct audit, unit defaults and all original collections',async()=>{
  const f=await fixture('belle-online'),owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example'),key=randomUUID(),legacyId=randomUUID(),old={amount:34500,status:'reserved',paymentStatus:'unpaid'},oldNames=['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta']
  for(const name of oldNames)await db.doc(`users/demo-owner/${name}/${legacyId}`).set(old)
  const before=await state(f.shop),input=body(f,{actorId:'forged',authorizationMode:'manager-override',unitCost:0,reason:' Zero-cost adjustment '})
  assert.equal((await http(null,input,key)).status,401);assert.equal((await http(other,input,key)).status,403);assert.equal((await http(owner,input)).status,400);assert.deepEqual(await state(f.shop),before)
  const r=await http(owner,input,key);assert.equal(r.status,201);assert.equal(r.data.balance.onHand,'7');assert.equal(r.data.balance.version,2);assert.equal(r.data.movement.unitCost,0);assert.equal(r.data.movement.actorUid,'demo-owner');assert.equal(r.data.movement.type,'ADJUSTMENT_IN');assert.equal(r.data.movement.unitSnapshot.unitId,f.product.units[0].unitId)
  const after=await state(f.shop),audit=after.pos_audit.map(([,row])=>row).find(row=>row.action==='inventory.adjust'&&row.entityId===input.balanceId);assert.deepEqual(audit.metadata,{action:'ADD',quantity:'2',expectedVersion:1,actorRole:'OWNER',authorizationMode:'direct',reason:'Zero-cost adjustment'});assert(after.pos_locations.some(([,row])=>row.name==='Main'));assert(after.pos_units.some(([,row])=>row.name==='Piece'))
  assert.deepEqual(new Map(after.pos_products).get(f.product.id),new Map(before.pos_products).get(f.product.id));const replay=await http(owner,input,key);assert.equal(replay.status,201);assert.deepEqual(replay.data,r.data);assert.deepEqual(await state(f.shop),after)
  assert.equal((await http(owner,{...input,quantity:3},key)).status,409);assert.deepEqual(await state(f.shop),after)
  for(const name of oldNames)assert.deepEqual((await db.doc(`users/demo-owner/${name}/${legacyId}`).get()).data(),old)
})

test('FIFO removal protects active holds and consumed allocations, keeps weighted cost/history and feeds real checkout',async()=>{
  const f=await fixture();await pos.create(f.shop,checkout(f.product,1),'demo-owner',randomUUID(),{checkout:true});const hold=await ledger.reservation(f.shop,{productId:f.product.id,sourceType:'PosOrder',sourceId:randomUUID(),quantity:1},'demo-owner',randomUUID());await ledger.receive(f.shop,{productId:f.product.id,quantity:5,unitCost:300},'demo-owner',randomUUID())
  const before=await state(f.shop),current=await balance(f),r=await adjustments.adjust(f.shop,body(f,{expectedVersion:current.version,action:'REMOVE',quantity:7}),'demo-owner',randomUUID());assert.equal(r.balance.onHand,'2');assert.equal(r.balance.reserved,'1');assert.equal(r.movement.type,'ADJUSTMENT_OUT')
  const after=await state(f.shop),evidence=after.pos_inventory_adjustments[0][1];assert.deepEqual(evidence.slices.map(row=>[row.baseQuantity,row.unitCost]),[['3',100],['4',300]])
  const first=before.stock_batches.find(([,row])=>row.unitCost===100)[0],batch=new Map(after.stock_batches).get(first);assert.equal(batch.physicalBaseQuantity,'1');assert.equal(batch.heldBaseQuantity,'1');assert.equal(batch.consumedBaseQuantity,'1');assert.equal(batch.baseQuantity,'2');assert.equal(batch.reservedBaseQuantity,'2')
  for(const name of ['pos_orders','pos_payments','stock_reservations','pos_products'])assert.deepEqual(after[name],before[name]);for(const [key,value]of before.stock_movements)assert.deepEqual(new Map(after.stock_movements).get(key),value)
  const denied=await state(f.shop);await assert.rejects(adjustments.adjust(f.shop,body(f,{expectedVersion:r.balance.version,action:'REMOVE',quantity:2}),'demo-owner',randomUUID()),/available stock negative/);assert.deepEqual(await state(f.shop),denied)
  await ledger.reservation(f.shop,{productId:f.product.id,sourceType:hold.sourceType,sourceId:hold.sourceId,action:'release'},'demo-owner',randomUUID());const sale=await pos.create(f.shop,checkout(f.product,2),'demo-owner',randomUUID(),{checkout:true});assert.equal(sale.order.total,1000);assert.equal((await balance(f)).onHand,'0')
})

test('Source strict three-decimal inputs, optimistic version, prior movement-only key, authority drift and pending advanced cases fail atomically',async()=>{
  const f=await fixture(),before=await state(f.shop)
  for(const extra of [{quantity:'1.2345'},{quantity:'0.0004'},{quantity:'NaN'},{quantity:0},{quantity:-1},{quantity:'2147483648'},{unitCost:2147483648},{expectedVersion:0},{action:'SET'},{reason:' '}])await assert.rejects(adjustments.adjust(f.shop,body(f,extra),'demo-owner',randomUUID()))
  await assert.rejects(adjustments.adjust(f.shop,body(f),'demo-other',randomUUID()),/owner/);assert.deepEqual(await state(f.shop),before)
  const r=await adjustments.adjust(f.shop,body(f,{quantity:'1.235'}),'demo-owner',randomUUID());assert.equal(r.balance.onHand,'6.235');assert.equal(r.movement.baseQuantity,'1.235')
  const stale=await state(f.shop);await assert.rejects(adjustments.adjust(f.shop,body(f),'demo-owner',randomUUID()),/concurrently/);assert.deepEqual(await state(f.shop),stale)
  const key=randomUUID();await table(f.shop,'stock_movements').doc(randomUUID()).set({idempotencyKey:key});const recorded=await state(f.shop);await assert.rejects(adjustments.adjust(f.shop,body(f,{expectedVersion:2}),'demo-owner',key),/already recorded/);assert.deepEqual(await state(f.shop),recorded)
  for(const trackingMode of ['LOT','SERIAL']){await table(f.shop,'pos_products').doc(f.product.id).update({trackingMode});const current=await balance(f),advanced=await adjustments.adjust(f.shop,body(f,{expectedVersion:current.version}),'demo-owner',randomUUID());assert.equal(advanced.balance.onHand,String(Number(current.onHand)+2))}
  await table(f.shop,'pos_products').doc(f.product.id).update({trackingMode:'NONE'});await table(f.shop,'pos_settings').doc('main').set({ledgerEnabled:false});const disabled=await balance(f),disabledResult=await adjustments.adjust(f.shop,body(f,{expectedVersion:disabled.version}),'demo-owner',randomUUID());assert.equal(disabledResult.movement,null);assert.equal(disabledResult.balance.onHand,disabled.onHand);assert.equal(disabledResult.balance.version,disabled.version)
  await table(f.shop,'pos_settings').doc('main').set({ledgerEnabled:true});await table(f.shop,'stock_balances').doc(stockScopeKey(f.product.id)).update({onHand:'99'});const drift=await state(f.shop);await assert.rejects(adjustments.adjust(f.shop,body(f,{expectedVersion:disabledResult.balance.version}),'demo-owner',randomUUID()),/reconciliation/);assert.deepEqual(await state(f.shop),drift)
})

test('Concurrent removal versus checkout has one last-stock winner; same-key repeats append once and return original version',async()=>{
  const f=await fixture(undefined,2),results=await Promise.allSettled([adjustments.adjust(f.shop,body(f,{action:'REMOVE'}),'demo-owner',randomUUID()),pos.create(f.shop,checkout(f.product,2),'demo-owner',randomUUID(),{checkout:true})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal((await balance(f)).onHand,'0')
  const g=await fixture(),key=randomUUID(),requests=await Promise.all(Array.from({length:4},()=>adjustments.adjust(g.shop,body(g),'demo-owner',key)));for(const result of requests)assert.deepEqual(result,requests[0]);assert.equal((await rows(g.shop,'pos_inventory_adjustments')).length,1)
  await adjustments.adjust(g.shop,body(g,{expectedVersion:2,action:'REMOVE',quantity:1}),'demo-owner',randomUUID());const after=await state(g.shop),replay=await adjustments.adjust(g.shop,body(g),'demo-owner',key);assert.equal(replay.balance.onHand,'7');assert.equal(replay.balance.version,2);assert.equal((await balance(g)).onHand,'6');assert.deepEqual(await state(g.shop),after)
})

test('Physical location adjustment cannot take other-site batches; child ADD keeps source latest cost/lineage with rollback on overflow',async()=>{
  const f=await fixture(),target=(await locations.create(f.shop,{name:'Other '+randomUUID()})).location;await transfers.transfer(f.shop,{sourceBalanceId:stockScopeKey(f.product.id),expectedVersion:1,targetLocationId:target.id,quantity:4,reason:'Move four'},'demo-owner',randomUUID())
  const other=await balance(f,target.id),before=await state(f.shop);await assert.rejects(adjustments.adjust(f.shop,body(f,{expectedVersion:2,action:'REMOVE',quantity:2}),'demo-owner',randomUUID()),/available stock negative/);assert.deepEqual(await state(f.shop),before)
  const r=await adjustments.adjust(f.shop,body(f,{balanceId:other.id,expectedVersion:other.version,action:'REMOVE',quantity:3}),'demo-owner',randomUUID());assert.equal(r.balance.onHand,'1');assert.equal((await balance(f)).onHand,'1')
  // The source transfer producer is pending; this relation is explicitly an
  // isolated reader/adjustment fixture, not proof of producer completion.
  await table(f.shop,'pos_product_transfer_links').doc(randomUUID()).set({childProductId:f.product.id,parentProductId:randomUUID()});const childBefore=await state(f.shop);await assert.rejects(adjustments.adjust(f.shop,body(f,{expectedVersion:2,unitCost:0}),'demo-owner',randomUUID()),/existing transferred batch cost/);assert.deepEqual(await state(f.shop),childBefore)
  const added=await adjustments.adjust(f.shop,body(f,{expectedVersion:2,quantity:2}),'demo-owner',randomUUID());assert.equal(added.balance.onHand,'3');const after=await state(f.shop);assert.equal(after.stock_batches.length,childBefore.stock_batches.length);assert.equal(new Map(after.stock_batches).get(added.movement.inventoryBatchId).unitCost,100)
  const overflowBefore=await state(f.shop);await assert.rejects(adjustments.adjust(f.shop,body(f,{expectedVersion:3,quantity:'2147483647'}),'demo-owner',randomUUID()),/supported range/);assert.deepEqual(await state(f.shop),overflowBefore)
})

test('Public bound stock sees actual adjustment; guest-held quantity blocks owner removal without changing public order evidence',async()=>{
  const f=await fixture(undefined,2),stock=createShopStock({db}),publicOrders=createOrderService({db,checkoutEnabled:true}),published=normalizeProduct({name:'Adjusted public '+randomUUID(),slug:'adjust-'+randomUUID(),status:'published',variants:[{sku:randomUUID(),color:'Brown',size:'1',price:500,active:true}]},null,f.shop)
  await table(f.shop,'products').doc(published.id).set(published);await stock.bind(f.shop,{public_product_id:published.id,public_variant_id:published.variants[0].id,pos_product_id:f.product.id},'demo-owner')
  await adjustments.adjust(f.shop,body(f,{action:'REMOVE',quantity:1}),'demo-owner',randomUUID());assert.equal((await stock.project(f.shop,[published]))[0].variants[0].available,1)
  const input=quantity=>({request_key:randomUUID(),tracking_token:'b'.repeat(64),customer:{name:'Adjustment buyer',phone:'099123456',city:'Yangon',address:'Private address'},items:[{variant_id:published.variants[0].id,quantity}]})
  await assert.rejects(publicOrders.checkout(f.shop,input(2)));await publicOrders.checkout(f.shop,input(1));const current=await balance(f),before=await state(f.shop),savedOrders=await rows(f.shop,'orders');assert.equal((await stock.project(f.shop,[published]))[0].variants[0].available,0)
  await assert.rejects(adjustments.adjust(f.shop,body(f,{expectedVersion:current.version,action:'REMOVE',quantity:1}),'demo-owner',randomUUID()),/available stock negative/);assert.deepEqual(await state(f.shop),before);assert.deepEqual(await rows(f.shop,'orders'),savedOrders)
  await adjustments.adjust(f.shop,body(f,{expectedVersion:current.version,quantity:1}),'demo-owner',randomUUID());assert.equal((await stock.project(f.shop,[published]))[0].variants[0].available,1);assert.equal((await balance(f)).reserved,'1');assert.deepEqual(await rows(f.shop,'orders'),savedOrders)
})


test('Inventory deletion preserves the source unconditional refusal for existing or absent IDs and never reads or writes a database',()=>{
 const denied=createPosInventoryAdjustments({db:new Proxy({},{get(){throw Error('Deletion must not access a database')}}),ownerUid:'demo-owner'})
 for(const batchId of ['existing','absent'])assert.throws(()=>denied.deleteBatch('belle-online',batchId,'demo-owner'),error=>error.status===400&&error.message==='Inventory records cannot be deleted. Use an adjustment, return, quarantine, or reversal so the audit trail is preserved.')
 assert.throws(()=>denied.deleteBatch('belle-online','existing','another-user'),error=>error.status===403)
})
