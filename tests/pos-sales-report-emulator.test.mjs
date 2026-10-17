import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {createPosSalesReport} from '../../BelleLocal POS app/functions/src/pos/sales-report.js'
import {salesReportResult} from '../../BelleLocal POS app/functions/src/pos/sales-report-domain.js'
import {createHistoryService} from '../../BelleLocal POS app/functions/src/pos/history.js'
import {createShopApi} from '../../BelleLocal POS app/functions/src/online-shop/api.js'
import {createServer} from 'node:http'
import {once} from 'node:events'
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Sales report requires isolated loopback Firebase services.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url)),{initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth');const firebaseApp=initializeApp({projectId:'demo-belle-online'});const db=getFirestore(),auth=getAuth(),clock=Date.parse('2026-09-10T03:30:00Z'),report=createPosSalesReport({db,now:()=>clock}),table=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`),put=async(shop,name,key,data)=>table(shop,name).doc(key).set({id:key,...data}),rows=async(shop,name)=>(await table(shop,name).get()).docs.map(row=>row.data()).sort((a,b)=>a.id.localeCompare(b.id)),names=['pos_orders','pos_payments','pos_products','pos_categories'],state=async shop=>Object.fromEntries(await Promise.all(names.map(async name=>[name,await rows(shop,name)]))),at='2026-09-10T03:30:00Z',query={from:'2026-09-10',to:'2026-09-10'}
async function fixture(){const shop='sales-report-'+randomUUID();await put(shop,'pos_categories','retail',{name:'Retail'});await put(shop,'pos_products','product',{name:'Original product',categoryId:'retail',isActive:true,cost:99999});await put(shop,'pos_orders','order',{total:100000,fulfillmentStatus:'completed',createdAt:at,completedAt:at,items:[{id:'item',productId:'product',quantity:1,baseQuantity:null,costValue:null,unitCost:60000,lineTotal:100000,recognizedAt:at}]});await put(shop,'pos_payments','payment',{orderId:'order',orderIds:null,allocations:null,originalPaymentId:null,type:'payment',scope:'order-payment',method:'Cash',amount:100000,paidAt:at});return shop}

test('Original source refund example is exact on Firebase: collections and gross profit subtract refund once while invoice/cost/category and zero comparison remain intact',async()=>{
 const shop=await fixture();await put(shop,'pos_payments','refund',{orderId:'order',originalPaymentId:'payment',type:'refund',scope:'financial-refund',method:'Wallet',amount:-20000,paidAt:at});const before=await state(shop),result=await report.get(shop,query);assert.equal(result.collectionTotal,80000);assert.deepEqual(result.paymentCollections,[{method:'Cash',amount:80000,percentage:100}]);assert.deepEqual(result.summary.totalSales,{current:100000,previous:0,change:100000,percentage:null});assert.equal(result.summary.totalCostPrice.current,60000);assert.equal(result.summary.grossProfit.current,20000);assert.deepEqual(result.categories,[{name:'Retail',amount:100000,percentage:100}]);assert.deepEqual(result.trend,[{key:'2026-09-10',sales:100000,orders:1}]);assert.deepEqual(result.range.previous,{from:'2026-09-09',to:'2026-09-09'});assert.deepEqual(await state(shop),before)
 const other=await fixture(),plain=await report.get(other,query);assert.equal(plain.collectionTotal,100000);assert.equal(plain.summary.grossProfit.current,40000)
})

test('Completion dates, period comparison and Yangon midnight preserve fractional base/costValue COGS, compatible item counts and current category assignment',async()=>{
 const shop=await fixture(),old='2026-09-09T03:30:00Z';await put(shop,'pos_orders','previous',{total:50000,fulfillmentStatus:'completed',createdAt:old,completedAt:old,items:[{productId:'product',quantity:2,unitCost:15000,lineTotal:50000,recognizedAt:old}]});await put(shop,'pos_payments','previous',{orderId:'previous',amount:50000,method:'Cash',type:'payment',scope:'order-payment',paidAt:old});await put(shop,'pos_orders','reserved',{total:999999,fulfillmentStatus:'reserved',createdAt:at,completedAt:null,items:[]});await put(shop,'pos_orders','boundary',{total:1000,fulfillmentStatus:'completed',createdAt:old,completedAt:'2026-09-09T17:30:00Z',items:[{productId:'product',quantity:1,baseQuantity:'1.005',unitCost:100,lineTotal:1000,recognizedAt:null}]});await put(shop,'pos_orders','before-boundary',{total:1000,fulfillmentStatus:'completed',createdAt:old,completedAt:'2026-09-09T17:29:59.999Z',items:[{productId:'product',quantity:1,baseQuantity:'1',unitCost:100,costValue:'0.4',lineTotal:1000,recognizedAt:null}]});const before=await state(shop),result=await report.get(shop,query);assert.deepEqual(result.summary.totalSales,{current:101000,previous:51000,change:50000,percentage:98});assert.equal(result.summary.orders.current,2);assert.equal(result.summary.itemsSold.current,2);assert.equal(result.summary.totalCostPrice.current,60101);assert.equal(result.summary.totalCostPrice.previous,30000);assert.equal(result.summary.grossProfit.current,40899);assert.equal(result.salesSummary.find(row=>row.label==='Today').totalSales,101000);assert.equal(result.categories[0].amount,101000);assert.deepEqual(await state(shop),before)
 await table(shop,'pos_categories').doc('retail').update({name:'Renamed current category'});assert.equal((await report.get(shop,query)).categories[0].name,'Renamed current category')
})

test('Payment filtering uses whole completed sale, original refund method and allocation-first links; malformed/fallback links, unknown methods and COD voids retain source contracts',async()=>{
 const shop=await fixture();await table(shop,'pos_payments').doc('payment').update({amount:60000});await put(shop,'pos_payments','wallet',{orderId:'order',amount:40000,method:'Wallet',type:'payment',scope:'order-payment',paidAt:at});await put(shop,'pos_payments','refund',{orderId:'order',amount:-20000,originalPaymentId:'wallet',method:'Cash',type:'refund',scope:'product-return',paidAt:at});await put(shop,'pos_payments','void',{orderId:'order',amount:-40000,method:'Wallet',type:'payment',scope:'cod-settlement-void',paidAt:at});await put(shop,'pos_payments','unlinked',{orderId:null,amount:500000,method:'Cash',type:'payment',scope:'sale',paidAt:at});await put(shop,'pos_payments','noncompleted',{orderId:'reserved',amount:500000,method:'Cash',type:'payment',scope:'sale',paidAt:at});const before=await state(shop),cash=await report.get(shop,{...query,payment:'Cash'}),wallet=await report.get(shop,{...query,payment:'Wallet'});assert.equal(cash.summary.totalSales.current,100000);assert.equal(wallet.summary.totalSales.current,100000);assert.equal(cash.summary.grossProfit.current,40000);assert.equal(wallet.summary.grossProfit.current,20000);assert.equal(cash.collectionTotal,60000);assert.equal(wallet.collectionTotal,20000);assert.equal((await report.get(shop,{...query,payment:'Unknown'})).summary.orders.current,0);assert.deepEqual(await state(shop),before)
 await put(shop,'pos_orders','allocated',{total:500,fulfillmentStatus:'completed',createdAt:at,completedAt:at,items:[{productId:'product',quantity:1,unitCost:100,lineTotal:500}]});await put(shop,'pos_payments','cod',{orderId:null,orderIds:'["order"]',allocations:'[{"orderId":"allocated","amount":500}]',amount:500,method:'COD',type:'payment',scope:'cod-settlement',paidAt:at});const allocated=await report.get(shop,{...query,payment:'COD'});assert.equal(allocated.summary.orders.current,1);assert.equal(allocated.summary.totalSales.current,500);await table(shop,'pos_payments').doc('cod').update({allocations:'malformed'});assert.equal((await report.get(shop,{...query,payment:'COD'})).summary.totalSales.current,100000)
})

test('Daily/weekly/monthly/yearly buckets, source previous-month calendar behavior, default date range and empty/restricted metric views remain source-compatible',async()=>{
 const shop=await fixture();for(const [trend,key]of [['daily','2026-09-10'],['weekly','2026-09-08'],['monthly','2026-09'],['yearly','2026']])assert.equal((await report.get(shop,{...query,trend})).trend[0].key,key);assert.deepEqual((await report.get(shop,{...query,comparison:'month'})).range.previous,{from:'2026-08-01',to:'2026-08-31'});const october=await report.get(shop,{from:'2026-10-01',to:'2026-10-12',comparison:'month'});assert.deepEqual(october.range.previous,{from:'2026-08-31',to:'2026-09-30'});assert.equal((await report.get(shop)).range.from,'2026-09-01');assert.equal((await report.get(shop)).range.to,'2026-09-10');const empty=await report.get(shop,{from:'2020-01-01',to:'2020-01-01'});assert.equal(empty.summary.totalSales.current,0);assert.equal(empty.summary.totalSales.percentage,null);assert.deepEqual(empty.trend,[]);assert.deepEqual(empty.categories,[]);const hidden=salesReportResult({orders:[],payments:[]},{...query,trend:'daily',comparison:'period'},new Date(clock),{cost:false,profit:false});assert.equal(hidden.summary.totalCostPrice,undefined);assert.equal(hidden.summary.grossProfit,undefined);assert.ok(hidden.salesSummary.every(row=>row.totalCostPrice===undefined&&row.grossProfit===undefined));assert.equal(hidden.comparison.length,3)
})

test('Invalid schema and real missing product/category fail without writes, and all original legacy collections/raw noncompleted markers remain untouched',async()=>{
 const shop=await fixture(),legacyId=randomUUID(),legacyNames=['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta'],legacy={order:34500,originalProfit:5000};for(const name of legacyNames)await db.doc('users/demo-owner/'+name+'/'+legacyId).set(legacy);await put(shop,'pos_orders','raw-marker',{source:'Immutable fixture',quantity:'7'});const before=await state(shop);for(const q of [{from:'invalid'},{trend:'invalid'},{payment:''},{comparison:'invalid'}]){await assert.rejects(report.get(shop,q),e=>e.status===400);assert.deepEqual(await state(shop),before)};await report.get(shop,query);assert.deepEqual(await state(shop),before);await table(shop,'pos_products').doc('product').update({categoryId:'missing'});const invalid=await state(shop);await assert.rejects(report.get(shop,query),e=>e.status===409);assert.deepEqual(await state(shop),invalid);await table(shop,'pos_products').doc('product').delete();const missing=await state(shop);await assert.rejects(report.get(shop,query),e=>e.status===409);assert.deepEqual(await state(shop),missing);for(const name of legacyNames)assert.deepEqual((await db.doc('users/demo-owner/'+name+'/'+legacyId).get()).data(),legacy)
})

test('Actual Functions sales report HTTP requires verified owner and rejects its own orphan history evidence without source demo bypass',async()=>{
 // Earlier COD/payment HTTP fixtures omit this test-only product join.
 // Supply it without changing or removing any original invoice evidence.
 const fixtureProduct=db.doc('onlineShopV2/belle-online/pos_products/fixture');if(!(await fixtureProduct.get()).exists)await fixtureProduct.create({id:'fixture',name:'COD/payment test fixture',categoryId:null,isActive:true,cost:0})
 async function token(uid,email){try{await auth.createUser({uid,email,password:'Local-test-only-123!'})}catch(e){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(e.code))throw e}const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});return (await r.json()).idToken};const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example'),api='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/reports/sales',http=async(token,q='')=>{const r=await fetch(api+q,{headers:token?{Authorization:'Bearer '+token}:{}});return {status:r.status,data:await r.json()}}
 assert.equal((await http(null,'?demo=true')).status,401);assert.equal((await http(other)).status,403);assert.equal((await http(owner,'?trend=invalid')).status,400)
 const orphan=table('belle-online','legacy_heads').doc('sales-front-door-'+randomUUID());await orphan.create({version:1,source_hash:'fictional-orphan'})
 try{const result=await http(owner,'?from=2026-10-01&to=2026-10-12');assert.equal(result.status,409,JSON.stringify(result.data));assert.equal(result.data.code,'HISTORY_RECONCILIATION_REQUIRED');assert.equal(result.data.summary,undefined)}finally{await orphan.delete()}
})

async function legacyFixture(){
 const shop=await fixture(),uid='sales-original-'+randomUUID(),old=(name,key)=>db.doc(`users/${uid}/${name}/${key}`),legacy=(total,cost,extra={})=>({date:'2026-09-10',total,amountPaid:total,balanceDue:0,paymentStatus:'paid',fulfillmentStatus:'reserved',customer:{name:'Original report buyer'},items:[{quantity:1,unitPrice:total,unitCost:cost}],...extra})
 await old('orders','order').set(legacy(500,100,{paymentId:'paid',paymentIds:['paid']}));await old('payments','paid').set({orderId:'order',date:'2026-09-10',amount:500,method:'KBZ Pay 1',transactionId:'771001'})
 await old('orders','previous').set(legacy(200,60,{date:'2026-09-09',paymentId:'previous',paymentIds:['previous']}));await old('payments','previous').set({orderId:'previous',date:'2026-09-09',amount:200,method:'COD',billNumber:'771002',transactionId:'771002'})
 await old('orders','unpaid').set(legacy(300,80,{date:'2026-07-23',amountPaid:0,balanceDue:300,paymentStatus:'unpaid'}))
 return {shop,uid,old,legacy,report:createPosSalesReport({db,ownerUid:uid,now:()=>clock}),history:createHistoryService({db,ownerUid:uid,now:()=>clock}),original:async()=>Object.fromEntries(await Promise.all(['orders','payments'].map(async name=>[name,(await db.collection(`users/${uid}/${name}`).get()).docs.map(doc=>[doc.id,doc.data()])]))) }
}

test('Actual Sales API combines original/new report sources for its verified owner and rejects outsiders and corrupted evidence',async()=>{
 const f=await legacyFixture(),before=await f.original()
 async function token(uid){const email=uid+'@belle-demo.example';await auth.createUser({uid,email,password:'Local-test-only-123!'});const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});assert.equal(response.status,200);return (await response.json()).idToken}
 const owner=await token(f.uid),other=await token('sales-outsider-'+randomUUID()),handler=createShopApi({db,auth,ownerUid:f.uid,allowedShopId:f.shop})
 const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');req.path=url.pathname;req.query=Object.fromEntries(url.searchParams);res.set=(key,value)=>res.setHeader(key,value);res.status=value=>{res.statusCode=value;return res};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))};res.send=value=>res.end(value);await handler(req,res)})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 const api=`http://127.0.0.1:${server.address().port}/${f.shop}/admin/pos/reports/sales`,get=async(token,query='?from=2026-09-10&to=2026-09-10')=>{const response=await fetch(api+query,{headers:token?{Authorization:'Bearer '+token}:{}});return {status:response.status,data:await response.json()}}
 try{
  assert.equal((await get(null)).status,401);assert.equal((await get(other)).status,403);assert.equal((await get(owner,'?trend=invalid')).status,400)
  const result=await get(owner);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.summary.totalSales.current,100500);assert.equal(result.data.sourceReport.legacyOrders,3)
  assert.equal((await get(owner,'?from=2026-09-10&to=2026-09-10&payment=KBZ%20Pay%201')).data.summary.totalSales.current,500)
  const orphan=table(f.shop,'legacy_heads').doc('orphan');await orphan.create({version:1,source_hash:'fictional-orphan'})
  const invalid=await get(owner);assert.equal(invalid.status,409);assert.equal(invalid.data.code,'HISTORY_RECONCILIATION_REQUIRED');assert.equal(invalid.data.summary,undefined);assert.deepEqual(await f.original(),before)
 }finally{await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections()})}
})

test('Legacy Sales merges paid-reserved frozen cost, previous growth, trend/category and distinct original/new drill-down identities without writes',async()=>{
 const f=await legacyFixture(),before=await f.original(),result=await f.report.get(f.shop,query)
 assert.equal(result.summary.totalSales.current,100500);assert.equal(result.summary.totalSales.previous,200)
 assert.equal(result.summary.totalCostPrice.current,60100);assert.equal(result.summary.grossProfit.current,40400)
 assert.equal(result.summary.orders.current,2);assert.equal(result.summary.itemsSold.current,2)
 assert.equal(result.collectionTotal,100500);assert.equal(result.trend[0].sales,100500);assert.equal(result.trend[0].orders,2)
 assert.equal(result.categories.find(row=>row.name==='Belle history').amount,500)
 const old=result.sourceReport.records.find(row=>row.key==='legacy:order'),fresh=result.sourceReport.records.find(row=>row.key==='retails:order')
 assert.equal(old.fulfillmentStatus,'reserved');assert.equal(old.cost,100);assert.equal(old.sourcePath,`users/${f.uid}/orders/order`);assert.ok(old.href.includes('history?order=order'));assert.ok(fresh.href.endsWith('/sale/order'))
 for(const [trend,key]of [['weekly','2026-09-08'],['monthly','2026-09'],['yearly','2026']])assert.equal((await f.report.get(f.shop,{...query,trend})).trend[0].key,key)
 await table(f.shop,'pos_products').doc('product').update({cost:5,categoryId:null})
 assert.equal((await f.report.get(f.shop,query)).summary.totalCostPrice.current,60100)
 assert.deepEqual(await f.original(),before)
})

test('Legacy Sales payment filters, partial/final receipt dates and prior original recognition cannot join overlay receipts into new invoices',async()=>{
 const f=await legacyFixture(),before=await f.original()
 let filtered=await f.report.get(f.shop,{...query,payment:'KBZ Pay 1'});assert.equal(filtered.summary.totalSales.current,500);assert.equal(filtered.collectionTotal,500);assert.deepEqual(filtered.sourceReport.records.map(row=>row.key),['legacy:order'])
 await f.history.append(f.shop,'unpaid',{action:'payment',request_key:randomUUID(),amount:100,method:'KBZ Pay 1',transactionId:'771003',date:'2026-09-10'},f.uid)
 filtered=await f.report.get(f.shop,{...query,payment:'KBZ Pay 1'});assert.equal(filtered.summary.totalSales.current,500);assert.equal(filtered.collectionTotal,600)
 await f.history.append(f.shop,'unpaid',{action:'payment',request_key:randomUUID(),amount:200,method:'KBZ Pay 1',transactionId:'771004',date:'2026-09-10'},f.uid)
 const current=await f.report.get(f.shop,query),july=await f.report.get(f.shop,{from:'2026-07-23',to:'2026-07-23'})
 assert.equal(current.summary.totalSales.current,100500);assert.equal(current.collectionTotal,100800)
 assert.equal(july.summary.totalSales.current,300);assert.equal(july.summary.totalCostPrice.current,80);assert.equal(july.collectionTotal,0)
 const cash=await f.report.get(f.shop,{...query,payment:'Cash'});assert.equal(cash.summary.totalSales.current,100000);assert.deepEqual(cash.sourceReport.records.map(row=>row.key),['retails:order'])
 const unknown=await f.report.get(f.shop,{...query,payment:'Unknown'});assert.equal(unknown.summary.orders.current,0);assert.deepEqual(unknown.sourceReport.records,[])
 assert.deepEqual(await f.original(),before)
})

test('Legacy Sales keeps fractional old COGS unrounded, explicit cash refunds and invalid-date/payment anomalies visible without inventing category or sale dates',async()=>{
 const f=await legacyFixture()
 await f.old('orders','order').update({items:[{quantity:1.005,unitPrice:500,unitCost:0.1}]})
 for(const status of ['preorder','cancelled'])await f.old('orders',status).set(f.legacy(9000,900,{fulfillmentStatus:status}))
 await f.old('orders','refunded').set(f.legacy(90,10,{paymentStatus:'refunded',refundId:'refund'}));await f.old('payments','refund').set({orderId:'refunded',date:'2026-09-10',amount:90,type:'refund',method:'KBZ Pay 1'})
 await f.old('orders','undated').set(f.legacy(100,10,{date:null}));await f.old('payments','undated').set({orderId:'order',amount:20,method:'Cash'})
 const before=await f.original(),result=await f.report.get(f.shop,query)
 assert.equal(result.summary.totalSales.current,100500);assert.equal(result.summary.totalCostPrice.current,60000.1005)
 assert.equal(result.collectionTotal,100410);assert.ok(result.sourceReport.warnings.some(row=>row.type==='missing-or-invalid-sale-date'));assert.ok(result.sourceReport.warnings.some(row=>row.type==='missing-or-invalid-cash-date'))
 assert.ok(result.sourceReport.warnings.some(row=>row.type==='missing-payment'));assert.ok(!result.sourceReport.records.some(row=>row.sourceOrderId==='undated'))
 assert.deepEqual(await f.original(),before)
})

test('Sale Records uses the report recognition range, exposes stable current invoice identities and remains read-only for shops without legacy data',async()=>{
 const shop=await fixture(),before=await state(shop),result=await report.get(shop,query)
 assert.deepEqual(result.saleRecords,[{key:'retails:order',source:'retails',sourceOrderId:'order',orderNumber:'order',customerName:'',href:'#/sale/order',date:'2026-09-10',total:100000,fulfillmentStatus:'completed'}])
 assert.deepEqual((await report.get(shop,{from:'2026-08-01',to:'2026-08-01'})).saleRecords,[])
 assert.deepEqual(await state(shop),before)
})

test('Sale Records preserves distinct original/current sources, recognition totals and history links without rewriting legacy records',async()=>{
 const f=await legacyFixture(),before=await f.original(),result=await f.report.get(f.shop,query),old=result.sourceReport.records.filter(row=>row.source==='belle-history')
 for(const row of old)assert.deepEqual(result.saleRecords.find(value=>value.key===row.key),row)
 assert.equal(result.saleRecords.filter(row=>row.source==='retails').length,result.sourceReport.retailsCurrent.orders)
 assert.ok(result.saleRecords.every(row=>row.source==='belle-history'?row.href.startsWith('#/history?order='):row.href.startsWith('#/sale/')))
 assert.equal(new Set(result.saleRecords.map(row=>row.key)).size,result.saleRecords.length)
 assert.deepEqual(await f.original(),before)
})

test('Legacy Sales rejects tampered source/head/receipt and malformed original cash links with typed errors and no source repair',async()=>{
 for(const kind of ['source','receipt','links','method']){
  const f=await legacyFixture()
  if(['source','receipt'].includes(kind)){
   await f.history.append(f.shop,'unpaid',{action:'payment',request_key:randomUUID(),amount:100,method:'KBZ Pay 1',transactionId:'771005',date:'2026-09-10'},f.uid)
   if(kind==='source')await f.old('orders','unpaid').update({total:301})
   else{const receipt=(await table(f.shop,'pos_payments').where('source','==','legacy-overlay').get()).docs[0];await receipt.ref.update({amount:101})}
  }else await f.old('payments','paid').update(kind==='links'?{orderIds:'invalid'}:{method:{invalid:true}})
  const before=await f.original();await assert.rejects(f.report.get(f.shop,query),error=>error.status===409&&error.code==='HISTORY_RECONCILIATION_REQUIRED');assert.deepEqual(await f.original(),before)
 }
})

test.after(async()=>{await db.terminate();await deleteApp(firebaseApp)})
