import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {createPosInventoryTransfers} from '../../BelleLocal POS app/functions/src/pos/inventory-transfers.js'
import {createPosCatalog} from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import {createPosLocations} from '../../BelleLocal POS app/functions/src/pos/locations.js'
import {createPosOrders} from '../../BelleLocal POS app/functions/src/pos/orders.js'
import {createStockLedger,stockScopeKey} from '../../BelleLocal POS app/functions/src/pos/stock-ledger.js'
import {Decimal} from '../../BelleLocal POS app/functions/src/pos/quantity.js'
import {createShopStock} from '../../BelleLocal POS app/functions/src/online-shop/stock.js'
import {createOrderService} from '../../BelleLocal POS app/functions/src/online-shop/orders.js'
import {normalizeProduct} from '../../BelleLocal POS app/functions/src/online-shop/domain.js'
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Transfers require isolated loopback emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url)),{initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
initializeApp({projectId:'demo-belle-online'});const db=getFirestore(),auth=getAuth(),transfers=createPosInventoryTransfers({db}),catalog=createPosCatalog({db}),locations=createPosLocations({db}),pos=createPosOrders({db}),ledger=createStockLedger({db})
const table=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`),rows=async(shop,name)=>(await table(shop,name).get()).docs.map(row=>[row.id,row.data()]),names=['pos_products','pos_units','pos_locations','stock_batches','stock_balances','stock_movements','stock_reservations','pos_audit','pos_inventory_transfers','pos_inventory_transfer_locks','pos_orders','pos_payments','pos_catalog_locks','pos_location_locks'],state=async shop=>Object.fromEntries(await Promise.all(names.map(async name=>[name,await rows(shop,name)])))
async function fixture(shop='transfer-'+randomUUID(),quantity=10){const product=await catalog.create(shop,{name:'Transfer product '+randomUUID(),price:500,cost:100,units:[{name:'Piece',isBase:true,conversionFactor:1}],openingStock:{quantity,unitCost:100}},'demo-owner',randomUUID()),target=(await locations.create(shop,{name:'Transfer target '+randomUUID()})).location;return {shop,product,target}}
const sourceId=f=>stockScopeKey(f.product.id),body=(f,extra={})=>({sourceBalanceId:sourceId(f),expectedVersion:1,targetLocationId:f.target.id,quantity:'2',reason:'Move shelf stock',...extra})
const balance=async(f,location='main')=>(await table(f.shop,'stock_balances').doc(stockScopeKey(f.product.id,null,location)).get()).data()
const checkout=(p,quantity)=>({saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{method:'Cash',amount:500*quantity},items:[{productId:p.id,quantity}]})
async function token(uid,email){try{await auth.createUser({uid,email,password:'Local-test-only-123!'})}catch(e){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(e.code))throw e}const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});assert.equal(r.status,200);return (await r.json()).idToken}
async function http(owner,input,key){const r=await fetch('http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/inventory-operations/transfer',{method:'POST',headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer '+owner}:{}),...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(input)});return {status:r.status,data:await r.json()}}

test('Actual owner transfer HTTP creates paired source movements and defaults, retains costs/history and rejects outsiders without touching nine legacy collections',async()=>{
  const f=await fixture('belle-online'),owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example'),key=randomUUID(),legacyId=randomUUID(),old={amount:34500,status:'reserved',paymentStatus:'unpaid'},oldNames=['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta']
  for(const name of oldNames)await db.doc(`users/demo-owner/${name}/${legacyId}`).set(old)
  const before=await state(f.shop),input=body(f,{actorId:'forged'});assert.equal((await http(null,input,key)).status,401);assert.equal((await http(other,input,key)).status,403);assert.equal((await http(owner,input)).status,400);assert.deepEqual(await state(f.shop),before)
  const r=await http(owner,input,key);assert.equal(r.status,201);assert.equal(r.data.sourceBalance.onHand,'8');assert.equal(r.data.targetBalance.onHand,'2');assert.equal(r.data.outMovement.unitCost,100);assert.equal(r.data.inMovement.sourceId,sourceId(f)+':'+f.target.id);assert.equal(r.data.outMovement.actorUid,'demo-owner');assert.equal(r.data.inMovement.unitSnapshot.unitId,f.product.units[0].unitId)
  const after=await state(f.shop),audit=after.pos_audit.map(row=>row[1]).find(row=>row.action==='inventory.transfer'&&row.entityId===sourceId(f));assert.equal(audit.actorId,'demo-owner');assert.equal(audit.metadata.reason,'Move shelf stock');assert(after.pos_locations.some(([,row])=>row.name==='Main'));assert(after.pos_units.some(([,row])=>row.name==='Piece'))
  for(const [id,row]of before.stock_movements)assert.deepEqual(new Map(after.stock_movements).get(id),row)
  assert.deepEqual(new Map(after.pos_products).get(f.product.id),new Map(before.pos_products).get(f.product.id));assert.equal((await http(owner,input,key)).status,200);assert.deepEqual(await state(f.shop),after)
  for(const name of oldNames)assert.deepEqual((await db.doc(`users/demo-owner/${name}/${legacyId}`).get()).data(),old)
})

test('Physical transfers split available FIFO batches at original cost, retain holds/consumed allocations and feed real target-location checkout',async()=>{
  const f=await fixture(undefined,5);await pos.create(f.shop,checkout(f.product,1),'demo-owner',randomUUID(),{checkout:true});const held=await ledger.reservation(f.shop,{productId:f.product.id,sourceType:'PosOrder',sourceId:randomUUID(),quantity:1},'demo-owner',randomUUID());await ledger.receive(f.shop,{productId:f.product.id,quantity:5,unitCost:300},'demo-owner',randomUUID())
  const before=await state(f.shop),source=await balance(f),cost=new Map(before.pos_products).get(f.product.id).cost,r=await transfers.transfer(f.shop,body(f,{expectedVersion:source.version,quantity:'7'}),'demo-owner',randomUUID());assert.equal(r.sourceBalance.onHand,'2');assert.equal(r.sourceBalance.reserved,'1');assert.equal(r.targetBalance.onHand,'7');assert.equal(r.outMovement.unitCost,cost)
  const after=await state(f.shop),evidence=after.pos_inventory_transfers[0][1];assert.deepEqual(evidence.slices.map(row=>[row.baseQuantity,row.unitCost]),[['3',100],['4',300]])
  const originalBatch=before.stock_batches.find(([,row])=>row.unitCost===100)[0],originalAfter=new Map(after.stock_batches).get(originalBatch);assert.equal(originalAfter.physicalBaseQuantity,'1');assert.equal(originalAfter.heldBaseQuantity,'1');assert.equal(originalAfter.consumedBaseQuantity,'1');assert.equal(originalAfter.baseQuantity,'2');assert.equal(originalAfter.reservedBaseQuantity,'2')
  for(const name of ['pos_orders','pos_payments','stock_reservations','pos_products'])assert.deepEqual(after[name],before[name]);for(const [id,row]of before.stock_movements)assert.deepEqual(new Map(after.stock_movements).get(id),row)
  await ledger.reservation(f.shop,{productId:f.product.id,sourceType:held.sourceType,sourceId:held.sourceId,action:'release'},'demo-owner',randomUUID())
  const sale=await pos.create(f.shop,checkout(f.product,9),'demo-owner',randomUUID(),{checkout:true});assert.equal(sale.order.total,4500);assert.equal((await balance(f)).onHand,'0');assert.equal((await balance(f,f.target.id)).onHand,'0');assert(sale.order.items[0].allocations.some(row=>evidence.slices.some(slice=>slice.targetBatchId===row.inventoryBatchId)))
  const finalBatches=(await rows(f.shop,'stock_batches')).map(row=>row[1]);assert.equal(finalBatches.reduce((sum,row)=>sum.plus(row.consumedBaseQuantity),new Decimal(0)).toString(),'10')
})

test('Source three-decimal half-up rounding, optimistic versions, active target and tracking guards roll back; ledger-disabled behavior retains source audit-only semantics',async()=>{
  const f=await fixture(),before=await state(f.shop)
  for(const extra of [{expectedVersion:0},{targetLocationId:'missing'},{targetLocationId:'main'},{quantity:'0.0004'},{quantity:'NaN'},{quantity:'11'},{quantity:'-1'}])await assert.rejects(transfers.transfer(f.shop,body(f,extra),'demo-owner',randomUUID()))
  assert.deepEqual(await state(f.shop),before);await table(f.shop,'pos_locations').doc(f.target.id).update({isActive:false});await assert.rejects(transfers.transfer(f.shop,body(f),'demo-owner',randomUUID()),/Target/);await table(f.shop,'pos_locations').doc(f.target.id).update({isActive:true})
  await table(f.shop,'pos_products').doc(f.product.id).update({trackingMode:'LOT'});await assert.rejects(transfers.transfer(f.shop,body(f),'demo-owner',randomUUID()),/exact tracked/);await table(f.shop,'pos_products').doc(f.product.id).update({trackingMode:'NONE'})
  const rounded=await transfers.transfer(f.shop,body(f,{quantity:'1.2345'}),'demo-owner',randomUUID());assert.equal(rounded.outMovement.baseQuantity,'1.235');assert.equal(rounded.sourceBalance.onHand,'8.765')
  await table(f.shop,'pos_settings').doc('main').set({ledgerEnabled:false});const disabledBefore=await state(f.shop),disabled=await transfers.transfer(f.shop,body(f,{expectedVersion:2,quantity:1}),'demo-owner',randomUUID());assert.equal(disabled.outMovement,null);assert.equal(disabled.inMovement,null);const disabledAfter=await state(f.shop);for(const name of names.filter(name=>name!=='pos_audit'))assert.deepEqual(disabledAfter[name],disabledBefore[name]);assert.equal(disabledAfter.pos_audit.length,disabledBefore.pos_audit.length+1)
})

test('Concurrent quarantine transfer versus real checkout has one last-stock winner; same-key retries append exactly one transfer and preserve current source response',async()=>{
  const f=await fixture(undefined,2);await table(f.shop,'pos_locations').doc(f.target.id).update({type:'QUARANTINE'});const results=await Promise.allSettled([transfers.transfer(f.shop,body(f),'demo-owner',randomUUID()),pos.create(f.shop,checkout(f.product,2),'demo-owner',randomUUID(),{checkout:true})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1)
  const after=await state(f.shop),gross=after.stock_balances.reduce((sum,[,row])=>sum.plus(row.onHand),new Decimal(0));assert.equal(gross.toString(),results[0].status==='fulfilled'?'2':'0');assert.equal((await catalog.get(f.shop,f.product.id)).product.availableStock,0)
  const g=await fixture(),key=randomUUID(),requests=await Promise.all(Array.from({length:4},()=>transfers.transfer(g.shop,body(g),'demo-owner',key)));assert.equal(requests.filter(r=>!r.duplicate).length,1);assert.equal((await rows(g.shop,'pos_inventory_transfers')).length,1);assert.equal((await rows(g.shop,'stock_movements')).filter(([,row])=>row.sourceType==='InventoryTransfer').length,2)
  const first=requests.find(r=>!r.duplicate),snapshot=await state(g.shop),retry=await transfers.transfer(g.shop,body(g,{expectedVersion:999,quantity:'500',targetLocationId:'changed',reason:'Changed source payload allowed on retry'}),'demo-owner',key);assert.equal(retry.duplicate,true);assert.deepEqual(retry.movement,first.outMovement);assert.equal(retry.sourceBalance.onHand,'8');assert.deepEqual(await state(g.shop),snapshot)
})

test('A transferred public binding sees only current Sellable stock; real guest reservations block another location transfer without changing accepted evidence',async()=>{
  const f=await fixture(undefined,3),stock=createShopStock({db}),publicOrders=createOrderService({db,checkoutEnabled:true}),published=normalizeProduct({name:'Transferred public product',slug:'transfer-'+randomUUID(),status:'published',variants:[{sku:randomUUID(),color:'Brown',size:'1',price:500,active:true}]},null,f.shop)
  await table(f.shop,'products').doc(published.id).set(published);await stock.bind(f.shop,{public_product_id:published.id,public_variant_id:published.variants[0].id,pos_product_id:f.product.id},'demo-owner');await table(f.shop,'pos_locations').doc(f.target.id).update({type:'QUARANTINE'})
  await transfers.transfer(f.shop,body(f),'demo-owner',randomUUID());assert.equal((await stock.project(f.shop,[published]))[0].variants[0].available,1)
  const input=quantity=>({request_key:randomUUID(),tracking_token:'a'.repeat(64),customer:{name:'Transfer buyer',phone:'099123456',city:'Yangon',address:'Private address'},items:[{variant_id:published.variants[0].id,quantity}]})
  const before=await state(f.shop);await assert.rejects(publicOrders.checkout(f.shop,input(2)));assert.deepEqual(await state(f.shop),before);await publicOrders.checkout(f.shop,input(1));assert.equal((await stock.project(f.shop,[published]))[0].variants[0].available,0)
  const held=await state(f.shop),current=await balance(f);await assert.rejects(transfers.transfer(f.shop,body(f,{quantity:1,expectedVersion:current.version}),'demo-owner',randomUUID()),/availability negative/);assert.deepEqual(await state(f.shop),held);assert.equal((await balance(f,f.target.id)).onHand,'2')
})
