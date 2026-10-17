import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {createPosDashboard} from '../../BelleLocal POS app/functions/src/pos/dashboard.js'
import {calculateFinancialMetrics} from '../../BelleLocal POS app/functions/src/pos/financial-domain.js'
import {createHistoryService} from '../../BelleLocal POS app/functions/src/pos/history.js'
import {createShopApi} from '../../BelleLocal POS app/functions/src/online-shop/api.js'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {createLegacyStockOpening} from '../../BelleLocal POS app/functions/src/pos/legacy-stock-opening.js'
import {createPosCatalog} from '../../BelleLocal POS app/functions/src/pos/catalog.js'

if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Home requires isolated loopback Firebase emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url)),{initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth');initializeApp({projectId:'demo-belle-online'});const db=getFirestore(),auth=getAuth(),clock=Date.parse('2026-10-12T00:00:00Z'),home=createPosDashboard({db,now:()=>clock}),table=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`),put=async(shop,name,key,value)=>table(shop,name).doc(key).set({id:key,...value}),today='2026-10-11T18:00:00Z',yesterday='2026-10-11T17:29:59.999Z',names=['pos_orders','pos_payments','pos_expenses','pos_customers','pos_products','pos_categories','pos_purchases','pos_purchase_payments','pos_purchase_payment_reversals','pos_suppliers','stock_balances'],snapshot=async shop=>Object.fromEntries(await Promise.all(names.map(async name=>[name,(await table(shop,name).get()).docs.map(row=>[row.id,row.data()])])));
async function fixture(){const shop='home-'+randomUUID();await put(shop,'pos_customers','buyer',{name:'Saved buyer'});await put(shop,'pos_categories','category',{name:'Dresses'});for(const [id,cost,min,active]of [['p',100,5,true],['q',200,3,true],['inactive',300,0,false]])await put(shop,'pos_products',id,{name:id,sku:id.toUpperCase(),cost,minimumStock:min,isActive:active});for(const [id,total,status,createdAt,completedAt,qty,cost]of [['today',1000,'completed',today,today,1.5,101],['reserved',500,'reserved',today,null,1,80],['recognition',2000,'completed',yesterday,today,2,300],['old',800,'completed',yesterday,yesterday,1,100],['cancelled',700,'cancelled',today,today,1,50]])await put(shop,'pos_orders',id,{orderNumber:id,total,fulfillmentStatus:status,paymentStatus:'partial',customerId:'buyer',createdAt,completedAt,items:[{quantity:qty,baseQuantity:String(qty),unitCost:cost,recognizedAt:completedAt}]});for(const [id,orderId,amount,type,scope,paidAt,extra]of [['direct','today',400,'payment','sale',today,{}],['cod',null,250,'payment','cod-settlement',today,{orderIds:'["today"]',allocations:'[{"orderId":"today","amount":250}]'}],['void',null,-250,'payment','cod-settlement-void',today,{orderIds:'["today"]',allocations:'[{"orderId":"today","amount":250}]'}],['refund','today',-200,'refund','product-return',today,{originalPaymentId:'direct'}],['other','recognition',1000,'payment','sale',today,{}],['old-refund','old',-10,'refund','refund',yesterday,{}]])await put(shop,'pos_payments',id,{orderId,amount,type,scope,paidAt,method:'Cash',...extra});for(const [id,amount,category,spentAt,cancelledAt]of [['expense',50,'Transport',today,null],['income',20,' Income ',today,null],['cancelled',100,'Transport',today,today],['old',1000,'Transport',yesterday,null]])await put(shop,'pos_expenses',id,{amount,category,spentAt,cancelledAt});await put(shop,'pos_suppliers','supplier',{name:'Original supplier'});await put(shop,'pos_purchases','purchase',{supplierId:'supplier',total:500,paidAmount:100,status:'sent',expectedAt:today,purchaseNumber:'PO-A'});await put(shop,'pos_purchases','cancelled',{supplierId:'supplier',total:100,paidAmount:20,status:'cancelled',expectedAt:today,purchaseNumber:'PO-C'});await put(shop,'pos_purchase_payments','active',{purchaseId:'purchase',amount:90,paidAt:today,reversedAt:null});await put(shop,'pos_purchase_payments','old',{purchaseId:'purchase',amount:10,paidAt:yesterday,reversedAt:null});await put(shop,'pos_purchase_payments','reversed',{purchaseId:'purchase',amount:30,paidAt:today,reversedAt:null});await put(shop,'pos_purchase_payment_reversals','reverse',{purchaseId:'purchase',originalPaymentId:'reversed',reversedAt:today,reason:'Original reversal'});for(const [id,productId,onHand,reserved]of [['main','p',2,1],['floor','p',3,1],['quarantine','p',4,0],['low','q',3,1],['zero','inactive',0,0]])await put(shop,'stock_balances',id,{productId,onHand:String(onHand),reserved:String(reserved)});return shop}

test('Owner Home uses Yangon created-day and distinct completed recognition, immutable refunds/purchase reversals, physical aggregation and source cash/profit contracts',async()=>{
 const shop=await fixture();await put(shop,'stock_balances','untouched-security-marker',{quantity:'7',source:'Immutable fixture'});const before=await snapshot(shop),result=await home.get(shop);assert.deepEqual(result.summary,{revenue:2800,todaySales:1500,costOfGoods:752,inventoryValuation:1500,grossProfit:2048,operatingExpenses:50,netProfit:1998,todayProfit:1198,unpaidTotal:2150,customerReceivables:2150,supplierPayables:480,cashReceived:1650,purchasePayments:90,refunds:200,cashOut:360,cashBalance:1290,salesCount:2,ordersCount:5,customersCount:1,activeProductsCount:2,categoriesCount:1,stockUnits:12});assert.deepEqual(result.lowStock,[{productId:'q',productCode:'Q',productName:'q',minimumStock:3,availableQuantity:2}]);assert.equal(result.recentSales.length,2);assert.deepEqual(new Set(result.recentSales.map(row=>row.id)),new Set(['today','reserved']));assert.equal(result.recentSales.find(row=>row.id==='today').paymentMethod,'Cash');assert.equal(result.upcomingPayables.length,1);assert.equal(result.upcomingPayables[0].amount,400);assert.deepEqual(await snapshot(shop),before)
})

test('Financial port preserves exact fractional base COGS rounding and summed transferred cost; income/cancelled expenses and COD voids are not misclassified',()=>{
 const value=calculateFinancialMetrics({recognizedOrders:[{total:1000,items:[{quantity:2,baseQuantity:'1.005',unitCost:100},{quantity:1,unitCost:999,costValue:'0.4'},{quantity:1,unitCost:999,costValue:'0.4'}]}],payments:[{amount:-100,type:'refund'},{amount:-100,scope:'cod-settlement-void',type:'payment'}],expenses:[{amount:50,category:'Transport'},{amount:10,category:'income'},{amount:100,category:'Transport',cancelledAt:today}]});assert.deepEqual(value,{recognizedSalesBeforeRefunds:1000,refunds:100,netRevenue:900,costOfGoods:102,grossProfit:798,operatingExpenses:50,netProfit:748})
})

test('Explicit Home date ranges are source open-ended, invalid dates fail, orphan joins require reconciliation and all original Belle fixtures stay read-only',async()=>{
 const shop=await fixture(),key=randomUUID(),legacyNames=['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta'],legacy={sale:34500,profit:5000};for(const name of legacyNames)await db.doc('users/demo-owner/'+name+'/'+key).set(legacy);const all=await home.get(shop,{from:'2020-01-01'});assert.equal(all.summary.todaySales,4300);assert.equal(all.summary.revenue,3590);assert.equal(all.summary.operatingExpenses,1050);await assert.rejects(home.get(shop,{from:'not-date'}),e=>e.status===400);await put(shop,'stock_balances','orphan',{productId:'missing-product',onHand:'1',reserved:'0'});const before=await snapshot(shop);await assert.rejects(home.get(shop),e=>e.status===409);assert.deepEqual(await snapshot(shop),before);for(const name of legacyNames)assert.deepEqual((await db.doc('users/demo-owner/'+name+'/'+key).get()).data(),legacy)
})

test('Actual Home HTTP requires verified owner, rejects malformed ranges and returns source-shaped current Firebase financial/read-only data',async()=>{
 async function token(uid,email){try{await auth.createUser({uid,email,password:'Local-test-only-123!'})}catch(e){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(e.code))throw e}const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});return (await r.json()).idToken}
 const f=await historicalFixture(),owner=await token(f.uid,f.uid+'@belle-demo.example'),otherUid='home-outsider-'+randomUUID(),other=await token(otherUid,otherUid+'@belle-demo.example')
 const handler=createShopApi({db,auth,ownerUid:f.uid,allowedShopId:f.shop})
 const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');req.path=url.pathname;req.query=Object.fromEntries(url.searchParams);res.set=(key,value)=>res.setHeader(key,value);res.status=value=>{res.statusCode=value;return res};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))};res.send=value=>res.end(value);await handler(req,res)})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 const api=`http://127.0.0.1:${server.address().port}/${f.shop}/admin/pos/dashboard`,get=async(token,query='')=>{const r=await fetch(api+query,{headers:token?{Authorization:'Bearer '+token}:{}});return {status:r.status,data:await r.json()}}
 try{assert.equal((await get(null)).status,401);assert.equal((await get(other)).status,403);assert.equal((await get(owner,'?from=invalid')).status,400);const result=await get(owner);assert.equal(result.status,200,JSON.stringify(result.data));assert.ok(Number.isFinite(result.data.summary.todaySales));assert.ok(Number.isFinite(result.data.summary.todayProfit));assert.ok(Array.isArray(result.data.recentSales));assert.ok(Array.isArray(result.data.lowStock));assert.ok(Array.isArray(result.data.upcomingPayables));assert.equal(result.data.sourceReport.legacyOrders,2)}finally{await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections()})}
})

async function historicalFixture(){
 const shop=await fixture(),uid='home-original-'+randomUUID(),old=(table,key)=>db.doc(`users/${uid}/${table}/${key}`)
 const order=(total,cost,extra={})=>({date:'2026-10-12',total,amountPaid:total,balanceDue:0,paymentStatus:'paid',fulfillmentStatus:'reserved',customer:{name:'Original buyer'},items:[{quantity:1,unitPrice:total,unitCost:cost}],...extra})
 await old('orders','today').set(order(1000,200,{paymentId:'paid',paymentIds:['paid']}))
 await old('orders','recognition').set(order(300,50,{date:'2026-07-23',amountPaid:0,balanceDue:300,paymentStatus:'unpaid'}))
 await old('payments','paid').set({orderId:'today',date:'2026-10-12',amount:1000,method:'KBZ Pay 1',transactionId:'889001'})
 await old('expenses','expense').set({date:'2026-10-12',amount:10})
 const readOriginal=async()=>Object.fromEntries(await Promise.all(['orders','payments','expenses'].map(async name=>[name,(await db.collection(`users/${uid}/${name}`).get()).docs.map(doc=>[doc.id,doc.data()])])))
 return {shop,uid,old,order,readOriginal,home:createPosDashboard({db,ownerUid:uid,now:()=>clock}),history:createHistoryService({db,ownerUid:uid,now:()=>clock})}
}

test('Main Home adds original paid-reserved recognition, outstanding and dated cash once without colliding with new invoice IDs',async()=>{
 const f=await historicalFixture(),before=await f.readOriginal(),base=await home.get(f.shop),result=await f.home.get(f.shop)
 for(const [key,delta]of [['todaySales',1000],['todayProfit',790],['revenue',1000],['costOfGoods',200],['netProfit',790],['operatingExpenses',10],['unpaidTotal',300],['cashReceived',1000],['cashBalance',990]])assert.equal(result.summary[key],base.summary[key]+delta,key)
 assert.ok(result.recentSales.some(row=>row.id==='legacy:today'&&row.fulfillmentStatus==='reserved'))
 assert.ok(result.recentSales.some(row=>row.id==='today'&&row.sourceKey==='retails:today'))
 assert.equal(result.sourceReport.legacyCash.receipts[0].sourcePath,`users/${f.uid}/payments/paid`)
 assert.equal(result.sourceReport.snapshotHash.length,64);assert.deepEqual(await f.readOriginal(),before)
 await f.history.append(f.shop,'recognition',{action:'payment',request_key:randomUUID(),amount:100,method:'KBZ Pay 1',transactionId:'889002',date:'2026-10-12'},f.uid)
 const deposit=await f.home.get(f.shop)
 assert.equal(deposit.summary.cashReceived,result.summary.cashReceived+100)
 assert.equal(deposit.summary.unpaidTotal,result.summary.unpaidTotal-100)
 assert.equal(deposit.summary.todaySales,result.summary.todaySales)
 const july=await f.home.get(f.shop,{from:'2026-07-23',to:'2026-07-23'});assert.equal(july.sourceReport.financial.legacy.revenue,0)
 await f.history.append(f.shop,'recognition',{action:'payment',request_key:randomUUID(),amount:200,method:'KBZ Pay 1',transactionId:'889003',date:'2026-10-12'},f.uid)
 const final=await f.home.get(f.shop)
 assert.equal(final.summary.cashReceived,result.summary.cashReceived+300)
 assert.equal(final.summary.unpaidTotal,result.summary.unpaidTotal-300)
 assert.equal(final.summary.todaySales,result.summary.todaySales)
 assert.equal((await f.home.get(f.shop,{from:'2026-07-23',to:'2026-07-23'})).sourceReport.financial.legacy.revenue,300)
 assert.deepEqual(await f.readOriginal(),before)
})

test('Home original cash refunds, missing dates and payment anomalies stay source-labelled and do not invent recognition or collections',async()=>{
 const f=await historicalFixture(),base=await f.home.get(f.shop)
 await f.old('orders','refunded').set(f.order(90,10,{paymentStatus:'refunded',refundId:'refund'}))
 await f.old('payments','refund').set({orderId:'refunded',date:'2026-10-12',type:'refund',amount:90,method:'KBZ Pay 1'})
 await f.old('payments','undated').set({orderId:'today',amount:50,method:'Cash'})
 await f.old('payments','orphan').set({orderId:'absent',amount:20,date:'2026-10-12',method:'Cash'})
 const before=await f.readOriginal(),result=await f.home.get(f.shop)
 assert.equal(result.summary.todaySales,base.summary.todaySales)
 assert.equal(result.summary.cashReceived,base.summary.cashReceived+20)
 assert.equal(result.summary.refunds,base.summary.refunds+90)
 assert.equal(result.summary.cashBalance,base.summary.cashBalance-70)
 assert.ok(result.sourceReport.warnings.some(row=>row.type==='missing-or-invalid-cash-date'))
 assert.ok(result.sourceReport.warnings.some(row=>row.type==='orphan-payment'))
 assert.deepEqual(await f.readOriginal(),before)
})

test('Home rejects corrupted continuation evidence and invalid original cash without returning cached-looking calculated totals',async()=>{
 for(const kind of ['overlay','cash']){
  const f=await historicalFixture()
  if(kind==='overlay'){
   await f.history.append(f.shop,'recognition',{action:'payment',request_key:randomUUID(),amount:100,method:'KBZ Pay 1',transactionId:'889004',date:'2026-10-12'},f.uid)
   const payment=(await table(f.shop,'pos_payments').where('source','==','legacy-overlay').get()).docs[0]
   await payment.ref.update({amount:101}) // fictional negative fixture only
  }else await f.old('payments','paid').update({amount:'invalid'})
  const before=await f.readOriginal()
  await assert.rejects(f.home.get(f.shop),error=>error.status===409&&error.code==='HISTORY_RECONCILIATION_REQUIRED')
  assert.deepEqual(await f.readOriginal(),before)
 }
})

test('Home physical units and valuation include original held stock once and completion changes no free stock or gross cost',async()=>{
 const f=await historicalFixture()
 await f.old('stocks','gross').set({quantity:5,unitCost:100,date:'2026-07-01',type:'-',size:'Other',color:'-'})
 const catalogue=createPosCatalog({db}),target=await catalogue.create(f.shop,{name:'Home original physical target',cost:100,price:500,units:[{name:'Piece',isBase:true,conversionFactor:1}]},f.uid,randomUUID())
 const opening=createLegacyStockOpening({db,ownerUid:f.uid,allowedShopId:f.shop,enabled:true}),preview=await opening.preview(f.shop,f.uid)
 const before=await f.readOriginal(),baseline=await f.home.get(f.shop)
 await opening.activate(f.shop,{expected_snapshot_hash:preview.snapshotHash,mappings:[{legacy_variant_key:preview.variants[0].key,pos_product_id:target.id}]},f.uid,randomUUID())
 const first=await f.home.get(f.shop)
 assert.equal(first.summary.stockUnits,baseline.summary.stockUnits+5)
 assert.equal(first.summary.inventoryValuation,baseline.summary.inventoryValuation+500)
 await f.history.append(f.shop,'recognition',{action:'complete',request_key:randomUUID()},f.uid)
 const completed=await f.home.get(f.shop),product=(await catalogue.get(f.shop,target.id)).product
 assert.equal(completed.summary.stockUnits,first.summary.stockUnits-1)
 assert.equal(completed.summary.inventoryValuation,first.summary.inventoryValuation-100)
 assert.equal(product.availableStock,3);assert.equal(product.cost,100)
 assert.deepEqual(await f.readOriginal(),before)
})
