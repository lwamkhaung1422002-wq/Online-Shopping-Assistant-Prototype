import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createLegacyStockOpening } from '../../BelleLocal POS app/functions/src/pos/legacy-stock-opening.js'
import { createPosCatalog } from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import { createPosProductReport } from '../../BelleLocal POS app/functions/src/pos/product-report.js'
import { createPosOrders } from '../../BelleLocal POS app/functions/src/pos/orders.js'
import { createShopStock } from '../../BelleLocal POS app/functions/src/online-shop/stock.js'
import { createOrderService } from '../../BelleLocal POS app/functions/src/online-shop/orders.js'
import { createHistoryService } from '../../BelleLocal POS app/functions/src/pos/history.js'
import { normalizeProduct, publicProduct } from '../../BelleLocal POS app/functions/src/online-shop/domain.js'
import { createShopApi } from '../../BelleLocal POS app/functions/src/online-shop/api.js'
import { createCombinedFinancial } from '../../BelleLocal POS app/functions/src/pos/combined-financial.js'
import { createPosSalesReport } from '../../BelleLocal POS app/functions/src/pos/sales-report.js'
import { createPosDashboard } from '../../BelleLocal POS app/functions/src/pos/dashboard.js'
import { createPosPaymentReport } from '../../BelleLocal POS app/functions/src/pos/payment-report.js'

if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Staged opening requires isolated loopback Firebase services.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url))
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
initializeApp({projectId:'demo-belle-online'});const db=getFirestore(),auth=getAuth()
const collection=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`)
const rows=async(shop,name)=>(await collection(shop,name).get()).docs.map(doc=>({...doc.data(),id:doc.id}))
const old=(f,name,key)=>db.doc(`users/${f.uid}/${name}/${key}`)
const original=async f=>Object.fromEntries(await Promise.all(['stocks','orders','payments','expenses','stockAdjustments','audit','catalog','paymentReferences','meta'].map(async name=>[name,(await db.collection(`users/${f.uid}/${name}`).get()).docs.map(doc=>[doc.id,doc.data()])])))
const baseline=async f=>(await collection(f.shop,'legacy_stock_baselines').doc('main').get()).data()
async function fixture(count=120){
 const uid='staging-'+randomUUID(),shop=uid,f={uid,shop,catalog:createPosCatalog({db}),stock:createShopStock({db}),pos:createPosOrders({db}),publicOrders:createOrderService({db,checkoutEnabled:true})}
 f.opening=createLegacyStockOpening({db,ownerUid:uid,allowedShopId:shop,enabled:true})
 const batch=db.batch()
 for(let index=0;index<count;index++)batch.set(old(f,'stocks','a'+String(index).padStart(3,'0')),{date:'2026-07-01',quantity:2,unitCost:index%2?300:100,type:'Elegence',size:'1',color:'Brown'})
 for(const [key,status,allocations]of [['reserved','reserved',[{stockBatchId:'a000',quantity:1,unitCost:100}]],['completed','completed',[]]])batch.set(old(f,'orders',key),{date:'2026-07-23',total:500,paymentStatus:'unpaid',fulfillmentStatus:status,items:[{quantity:1,unitPrice:500,unitCost:100,type:'Elegence',size:'1',color:'Brown',allocations}]})
 for(const name of ['payments','expenses','stockAdjustments','audit','catalog','paymentReferences','meta'])batch.set(old(f,name,'immutable'),{fictionalOriginal:true})
 await batch.commit()
 f.product=await f.catalog.create(shop,{name:'Actual staged stock target',price:500,cost:100,units:[{name:'Piece',isBase:true,conversionFactor:1}]},uid,randomUUID())
 f.publicProduct=normalizeProduct({name:'Staged original design',slug:uid,status:'published',variants:[{sku:uid,size:'1',color:'Brown',price:500,active:true}]},null,shop)
 await collection(shop,'products').doc(f.publicProduct.id).set(f.publicProduct)
 await f.stock.bind(shop,{public_product_id:f.publicProduct.id,public_variant_id:f.publicProduct.variants[0].id,pos_product_id:f.product.id},uid)
 const preview=await f.opening.preview(shop,uid)
 f.body={expected_snapshot_hash:preview.snapshotHash,mappings:[{legacy_variant_key:preview.variants[0].key,pos_product_id:f.product.id}]}
 return f
}
const activate=(f,key=randomUUID(),body=f.body)=>f.opening.activate(f.shop,body,f.uid,key)
async function finish(f,key=randomUUID()){
 let result
 for(let attempt=0;attempt<20;attempt++){result=await activate(f,key);if(result.status!=='STAGING')return result}
 throw Error('Opening did not finish within fixture stage count')
}
const stockConflict=error=>error.status===409&&/opening|stock|authority|reconciliation/i.test(error.message)
const sale=f=>({saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{amount:500,method:'Cash'},items:[{productId:f.product.id,quantity:1}]})

test('100 fractional source batches stage exact aggregate quantities while retaining held and consumed FIFO rights',async()=>{
 const f=await fixture(100),batch=db.batch()
 for(let index=0;index<100;index++)batch.update(old(f,'stocks','a'+String(index).padStart(3,'0')),{quantity:0.3})
 batch.update(old(f,'orders','reserved'),{items:[{quantity:1.1,unitPrice:500,unitCost:100,type:'Elegence',size:'1',color:'Brown',allocations:[]}]})
 batch.update(old(f,'orders','completed'),{date:'2026-07-24',items:[{quantity:1.2,unitPrice:500,unitCost:100,type:'Elegence',size:'1',color:'Brown',allocations:[]}]})
 await batch.commit()
 const preview=await f.opening.preview(f.shop,f.uid);assert.equal(preview.variants[0].available,27.7)
 f.body.expected_snapshot_hash=preview.snapshotHash;const before=await original(f)
 assert.equal((await finish(f)).availableGranted,27.7)
 let product=(await f.catalog.get(f.shop,f.product.id)).product
 assert.equal(product.currentStock,28.8);assert.equal(product.availableStock,27.7);assert.equal(product.cost,200)
 const projected=(await f.stock.project(f.shop,[f.publicProduct]))[0]
 assert.equal(projected.variants[0].available,27.7);assert.equal(publicProduct(projected,[],[]).variants[0].available,27)
 await createHistoryService({db,ownerUid:f.uid}).append(f.shop,'reserved',{action:'complete',request_key:randomUUID()},f.uid)
 product=(await f.catalog.get(f.shop,f.product.id)).product
 assert.equal(product.currentStock,27.7);assert.equal(product.availableStock,27.7)
 assert.deepEqual(await original(f),before)
})

test('120 source batches prepare in bounded stages, fence POS receipts/checkout and catalogue/report reads, and activate after immutable receipt/cost proof',async()=>{
 const f=await fixture(),before=await original(f),key=randomUUID(),first=await activate(f,key)
 assert.equal(first.status,'STAGING');assert.equal(first.stagingProgress.preparedBatches,50);assert.equal(first.stagingProgress.totalBatches,119)
 assert.equal((await baseline(f)).status,'STAGING');assert.equal((await rows(f.shop,'stock_batches')).length,50)
 await assert.rejects(f.catalog.get(f.shop,f.product.id),stockConflict)
 await assert.rejects(createPosProductReport({db}).get(f.shop),stockConflict)
 await assert.rejects(createPosSalesReport({db,ownerUid:f.uid}).get(f.shop),stockConflict)
 await assert.rejects(createPosDashboard({db,ownerUid:f.uid}).get(f.shop),stockConflict)
 await assert.rejects(createPosPaymentReport({db,ownerUid:f.uid}).get(f.shop),stockConflict)
 await assert.rejects(f.stock.project(f.shop,[f.publicProduct]),stockConflict)
 await assert.rejects(f.pos.create(f.shop,sale(f),f.uid,randomUUID(),{checkout:true}),stockConflict)
 await assert.rejects(f.catalog.receive(f.shop,{productId:f.product.id,quantity:1,unitCost:100},f.uid,randomUUID()),stockConflict)
 const review=await f.opening.preview(f.shop,f.uid);assert.equal(review.currentOpening,null);assert.equal(review.stagingProgress.preparedBatches,50);assert.equal(review.currentMappings[0].pos_product_id,f.product.id);assert.equal(review.targetProducts[0].name,f.product.name)
 const result=await finish(f,key);assert.equal(result.availableGranted,238);assert.equal(result.inventoryBatchIds.length,119);assert.equal(result.inventoryManifest.chunkCount,3)
 assert.equal((await rows(f.shop,'stock_batches')).length,119);assert.equal((await rows(f.shop,'stock_requests')).length,119)
 const product=(await f.catalog.get(f.shop,f.product.id)).product;assert.equal(product.currentStock,239);assert.equal(product.availableStock,238);assert.equal(product.cost,200)
 assert.equal((await f.stock.project(f.shop,[f.publicProduct]))[0].variants[0].available,238)
 await createHistoryService({db,ownerUid:f.uid}).append(f.shop,'reserved',{action:'complete',request_key:randomUUID()},f.uid)
 assert.equal((await f.catalog.get(f.shop,f.product.id)).product.currentStock,238)
 assert.equal((await activate(f,key)).replayed,true);assert.equal((await activate(f)).replayed,true)
 assert.deepEqual(await original(f),before)
})

test('Concurrent initial and resumed request keys share one staged job/checkpoint and never duplicate source receipts',async()=>{
 const f=await fixture(),before=await original(f)
 const first=await Promise.all([activate(f),activate(f)])
 assert.ok(first.every(result=>result.status==='STAGING'));assert.equal(new Set(first.map(result=>result.stagingProgress.jobId)).size,1)
 assert.equal((await rows(f.shop,'stock_batches')).length,100)
 const final=await Promise.all([finish(f),finish(f)])
 assert.ok(final.every(result=>result.availableGranted===238));assert.equal((await rows(f.shop,'stock_batches')).length,119)
 assert.equal((await rows(f.shop,'legacy_opening_chunks')).length,3);assert.equal((await rows(f.shop,'pos_audit')).filter(row=>row.action==='inventory.legacy_opening').length,1)
 assert.deepEqual(await original(f),before)
})

test('A normal receipt racing staged initialization either commits before the empty-target check or is fenced, never mixing both grants',async()=>{
 const f=await fixture(),before=await original(f)
 const [opening,receipt]=await Promise.allSettled([activate(f),f.catalog.receive(f.shop,{productId:f.product.id,quantity:1,unitCost:111},f.uid,randomUUID())])
 assert.ok(!(opening.status==='fulfilled'&&receipt.status==='fulfilled'))
 if(opening.status==='fulfilled'){
  assert.equal(opening.value.status,'STAGING');assert.equal(receipt.status,'rejected');assert.equal(receipt.reason.status,409)
  assert.equal((await finish(f)).availableGranted,238)
 }else{
  assert.equal(opening.reason.status,409);assert.equal(receipt.status,'fulfilled')
  assert.equal((await rows(f.shop,'legacy_stock_baselines')).length,0);assert.equal((await rows(f.shop,'stock_batches')).length,1)
 }
 assert.deepEqual(await original(f),before)
})

test('Legitimate original payment/completion during staging preserves original free rights, gross cost and frozen historical financial evidence',async()=>{
 const f=await fixture(),before=await original(f),key=randomUUID();await activate(f,key)
 const history=createHistoryService({db,ownerUid:f.uid})
 await history.append(f.shop,'reserved',{action:'payment',request_key:randomUUID(),amount:500,method:'KBZ Pay 1',transactionId:'880001',date:'2026-10-12'},f.uid)
 await history.append(f.shop,'reserved',{action:'complete',request_key:randomUUID()},f.uid)
 const result=await finish(f,key);assert.equal(result.availableGranted,238)
 const product=(await f.catalog.get(f.shop,f.product.id)).product
 assert.equal(product.currentStock,238);assert.equal(product.availableStock,238);assert.equal(product.cost,200)
 const financial=await createCombinedFinancial({db,ownerUid:f.uid}).get(f.shop)
 assert.equal(financial.financial.original.revenue,0);assert.equal(financial.financial.legacy.revenue,500);assert.equal(financial.financial.legacy.costOfGoods,100)
 assert.deepEqual(await original(f),before)
})

test('Source drift, changed target metadata and changed mappings block continuation without consuming or publishing partial stock',async()=>{
 for(const kind of ['source','target','mapping']){
  const f=await fixture();await activate(f);const stockBefore=await rows(f.shop,'stock_batches')
  let body=f.body
  if(kind==='source')await old(f,'stocks','a119').update({quantity:3}) // fictional negative fixture only
  if(kind==='target')await collection(f.shop,'pos_products').doc(f.product.id).update({name:'Changed fictional target'})
  if(kind==='mapping')body={...f.body,mappings:[{...f.body.mappings[0],pos_product_id:randomUUID()}]}
  const originalBefore=await original(f)
  await assert.rejects(activate(f,randomUUID(),body),stockConflict)
  assert.equal((await baseline(f)).status,'STAGING');assert.deepEqual(await rows(f.shop,'stock_batches'),stockBefore)
  await assert.rejects(f.stock.project(f.shop,[f.publicProduct]),stockConflict)
  assert.deepEqual(await original(f),originalBefore)
 }
})

test('Missing or corrupted staged checkpoint/physical receipt evidence never activates the source pool',async()=>{
 for(const kind of ['chunk','batch','movement','mapping']){
  const f=await fixture();await activate(f)
  if(kind==='chunk'){const chunks=await collection(f.shop,'legacy_opening_chunks').get();await chunks.docs[0].ref.delete()}
  if(kind==='batch'){const batches=await collection(f.shop,'stock_batches').get();await batches.docs[0].ref.update({unitCost:999})}
  if(kind==='movement'){const movements=await collection(f.shop,'stock_movements').get();await movements.docs[0].ref.delete()}
  if(kind==='mapping')await collection(f.shop,'legacy_stock_baselines').doc('main').update({mappings:[]})
  const before=await original(f)
  await assert.rejects(finish(f),stockConflict)
  assert.equal((await baseline(f)).status,'STAGING');await assert.rejects(f.catalog.get(f.shop,f.product.id),stockConflict)
  assert.deepEqual(await original(f),before)
 }
})

test('The fixed source-owner claim blocks another shop during staging and an invalid late target cannot initialize a partial job',async()=>{
 const f=await fixture();await activate(f);const secondShop='staging-other-'+randomUUID()
 const product=await f.catalog.create(secondShop,{name:'Different actual target',price:500,cost:100,units:[{name:'Piece',isBase:true,conversionFactor:1}]},f.uid,randomUUID())
 const second=createLegacyStockOpening({db,ownerUid:f.uid,allowedShopId:secondShop,enabled:true})
 await assert.rejects(second.activate(secondShop,{...f.body,mappings:[{...f.body.mappings[0],pos_product_id:product.id}]},f.uid,randomUUID()),stockConflict)
 assert.equal((await rows(secondShop,'legacy_stock_baselines')).length,0)
 const late=await fixture();await old(late,'stocks','z-missing').set({quantity:1,unitCost:100,type:'Elegence',size:'2',color:'Brown'})
 const preview=await late.opening.preview(late.shop,late.uid);late.body.expected_snapshot_hash=preview.snapshotHash;late.body.mappings.push({legacy_variant_key:preview.variants.find(value=>value.key.startsWith('2__')).key,pos_product_id:randomUUID()})
 await assert.rejects(activate(late),error=>error.status===404)
 assert.equal((await rows(late.shop,'stock_batches')).length,0);assert.equal((await rows(late.shop,'legacy_stock_baselines')).length,0)
})

test('Actual Auth owner API resumes staged requests while outsider/anonymous and client freeze flags cannot authorize activation',async()=>{
 const f=await fixture()
 async function token(uid){const email=uid+'@belle-demo.example';await auth.createUser({uid,email,password:'Local-test-only-123!'});const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});assert.equal(r.status,200);return(await r.json()).idToken}
 const owner=await token(f.uid),outsider=await token('outsider-'+randomUUID())
 const handler=createShopApi({db,auth,ownerUid:f.uid,allowedShopId:f.shop,legacyOpeningEnabled:true})
 const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');req.path=url.pathname;req.query=Object.fromEntries(url.searchParams);let raw='';for await(const chunk of req)raw+=chunk;req.body=raw?JSON.parse(raw):undefined;res.set=(key,value)=>res.setHeader(key,value);res.status=value=>{res.statusCode=value;return res};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))};res.send=value=>res.end(value);await handler(req,res)})
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/${f.shop}/admin/stock/legacy-opening`,key=randomUUID()
 const call=async(bearer,body=f.body)=>{const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,...(bearer?{Authorization:'Bearer '+bearer}:{})},body:JSON.stringify(body)});return{status:r.status,data:await r.json()}}
 try{
  assert.equal((await call()).status,401);assert.equal((await call(outsider)).status,403)
  let result=await call(owner);assert.equal(result.status,200);assert.equal(result.data.status,'STAGING')
  for(let n=0;n<10&&result.data.status==='STAGING';n++)result=await call(owner)
  assert.equal(result.status,200);assert.equal(result.data.availableGranted,238)
  const replay=await call(owner);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true)
  const gated=createLegacyStockOpening({db,ownerUid:f.uid,allowedShopId:f.shop,enabled:false})
  await assert.rejects(gated.activate(f.shop,{...f.body,enabled:true},f.uid,randomUUID()),stockConflict)
 }finally{await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections()})}
})
