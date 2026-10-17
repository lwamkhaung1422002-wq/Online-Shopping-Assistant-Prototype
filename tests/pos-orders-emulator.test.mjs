import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {createPosOrders} from '../../BelleLocal POS app/functions/src/pos/orders.js'
import {createPosPricing,priceTargetKey,promotionTargetKey} from '../../BelleLocal POS app/functions/src/pos/pricing.js'
import {createPosCatalog} from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import {createPosSettings} from '../../BelleLocal POS app/functions/src/pos/settings.js'
import {createPosContacts} from '../../BelleLocal POS app/functions/src/pos/contacts.js'
import {createPosPayments} from '../../BelleLocal POS app/functions/src/pos/payments.js'
import {createStockLedger,stockScopeKey} from '../../BelleLocal POS app/functions/src/pos/stock-ledger.js'
import {createShopStock} from '../../BelleLocal POS app/functions/src/online-shop/stock.js'
import {createOrderService} from '../../BelleLocal POS app/functions/src/online-shop/orders.js'
import {normalizeProduct} from '../../BelleLocal POS app/functions/src/online-shop/domain.js'
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('POS order tests require isolated local Auth/Firestore emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url))
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
initializeApp({projectId:'demo-belle-online'})
const db=getFirestore(),auth=getAuth(),catalog=createPosCatalog({db}),orders=createPosOrders({db}),ledger=createStockLedger({db})
const base='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
const table=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`)
async function token(uid,email){try{await auth.createUser({uid,email,password:'Local-test-only-123!'})}catch(error){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(error.code))throw error}const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});assert.equal(response.status,200);return (await response.json()).idToken}
async function http(path,method='GET',body,owner,key){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer '+owner}:{}),...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:response.status===204?null:await response.json()}}
async function product(shop,quantity=4){return catalog.create(shop,{name:'POS dress '+randomUUID().slice(0,8),price:200,cost:100,units:[{name:'Piece',isBase:true,conversionFactor:1}],openingStock:{quantity,unitCost:100}},'demo-owner',randomUUID())}
const checkout=(productId,quantity=1,extra={})=>({saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{method:'Cash',amount:200*quantity},items:[{productId,quantity}],...extra})

test('POS HTTP checkout uses server pricing, initial payment, completed stock, durable replay and customer/order source contracts',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example')
  assert.equal((await http('orders/next-number')).status,401)
  assert.equal((await http('orders/checkout','POST',{},other,randomUUID())).status,403)
  assert.equal((await http('pricing/resolve','POST',{},other)).status,403)
  const setting=await http('settings','GET',undefined,owner);assert.equal(setting.status,200);assert.equal(setting.data.settings.paymentMethods[0].name,'Cash')
  assert.equal((await http('settings','PATCH',{currencyCode:'USD'},owner)).status,409)
  const value=await product('belle-online',4),unit=value.units.find((row)=>row.isBase),key=randomUUID(),body=checkout(value.id,1.5,{expectedTotal:300,items:[{productId:value.id,quantity:1.5,unitPrice:1,unitId:unit.unitId,unitExpectation:{productUnitId:unit.id,conversionFactor:'1'}}],note:'Emulator checkout'})
  const legacy=db.doc('users/demo-owner/orders/checkout-legacy-'+randomUUID()),original={total:34500,customerName:'Historical fixture',paymentStatus:'unpaid',fulfillmentStatus:'reserved'}
  await legacy.set(original)
  assert.equal((await http('orders/checkout','POST',body,owner)).status,400)
  const next=await http('orders/next-number','GET',undefined,owner);assert.equal(next.status,200)
  const result=await http('orders/checkout','POST',body,owner,key)
  assert.equal(result.status,201,JSON.stringify(result.data));const order=result.data.order
  assert.equal(result.data.replayed,false);assert.equal(order.orderNumber,next.data.orderNumber)
  assert.equal(order.total,300);assert.equal(order.paymentStatus,'paid');assert.equal(order.fulfillmentStatus,'completed');assert.ok(order.completedAt)
  assert.equal(order.paymentTracking,false);assert.equal(order.items[0].baseQuantity,'1.5');assert.equal(order.items[0].quantity,2)
  assert.equal(order.items[0].unitPrice,200);assert.equal(order.items[0].unitCost,100);assert.equal(order.payments.length,1);assert.equal(order.payments[0].amount,300)
  const balance=(await table('belle-online','stock_balances').doc(stockScopeKey(value.id)).get()).data()
  assert.equal(balance.onHand,'2.5');assert.equal(balance.reserved,'0')
  const replay=await http('orders/checkout','POST',body,owner,key);assert.equal(replay.status,200);assert.equal(replay.data.order.id,order.id)
  assert.equal((await table('belle-online','pos_payments').where('orderId','==',order.id).get()).size,1)
  assert.equal((await table('belle-online','stock_movements').where('sourceId','==',order.items[0].allocations[0].id).get()).size,1)
  assert.equal((await http('orders/checkout','POST',{...body,note:'Different'},owner,key)).status,409)
  assert.equal((await http('orders/'+order.id,'GET',undefined,other)).status,403)
  assert.equal((await http('orders/'+order.id,'GET',undefined,owner)).data.order.items[0].product.id,value.id)
  const unitConflict=await http('orders/checkout','POST',checkout(value.id,1,{items:[{productId:value.id,quantity:1,unitId:unit.unitId,unitExpectation:{productUnitId:'stale',conversionFactor:'1'}}]}),owner,randomUUID())
  assert.equal(unitConflict.status,409);assert.equal(unitConflict.data.code,'UNIT_CHANGED');assert.equal(unitConflict.data.productId,value.id)
  const priceConflict=await http('orders/checkout','POST',checkout(value.id,1,{expectedTotal:1}),owner,randomUUID())
  assert.equal(priceConflict.status,409);assert.equal(priceConflict.data.code,'PRICE_CHANGED');assert.equal(priceConflict.data.total,200);assert.equal(priceConflict.data.items[0].pricing.finalUnitPrice,200)
  assert.equal((await http('orders/checkout','POST',checkout(value.id,3),owner,randomUUID())).status,400)
  const ordinary=await http('orders','POST',{customer:{name:'Embedded customer',phone:'09999999'},items:[{productId:value.id,quantity:0.5}],initialPayment:{method:'Cash',amount:20}},owner)
  assert.equal(ordinary.status,201,JSON.stringify(ordinary.data));assert.equal(ordinary.data.order.fulfillmentStatus,'reserved');assert.equal(ordinary.data.order.paymentStatus,'partial');assert.equal(ordinary.data.order.customer.name,'Embedded customer')
  assert.equal((await http('customers/'+ordinary.data.order.customerId,'DELETE',undefined,owner)).status,409)
  const preorder=await http('orders','POST',{fulfillmentStatus:'preorder',items:[{productId:value.id,quantity:100}],orderNumber:'PRE-'+randomUUID()},owner)
  assert.equal(preorder.status,201);assert.equal(preorder.data.order.items[0].allocations.length,0)
  assert.equal((await http('orders','POST',{fulfillmentStatus:'preorder',orderNumber:preorder.data.order.orderNumber,items:[{productId:value.id,quantity:1}]},owner)).status,409)
  assert.deepEqual((await legacy.get()).data(),original)
})

test('reference pricing resolves entry recency, unit conversion, tier specificity, universal/legacy promotions and atomic due activation',async()=>{
  const shop='pricing-'+randomUUID(),at=new Date('2026-09-01T00:00:00Z'),price=createPosPricing({db,now:()=>at.getTime()}),adapter=createPosOrders({db,now:()=>at.getTime()})
  const value=await catalog.create(shop,{name:'Pricing case',price:100,cost:50,units:[{name:'Piece',isBase:true,conversionFactor:1},{name:'Carton',conversionFactor:6}],openingStock:{quantity:20,unitCost:50}},'demo-owner',randomUUID())
  const carton=value.units.find((unit)=>!unit.isBase),globalKey=priceTargetKey(value.id),cartonKey=priceTargetKey(value.id,null,carton.id)
  await table(shop,'pos_price_groups').doc('vip').set({name:'VIP'})
  for(const entry of [{id:'old-global',targetKey:globalKey,unitPrice:90,effectiveFrom:'2026-06-01T00:00:00Z',status:'ACTIVE'},{id:'old-unit',targetKey:cartonKey,productUnitId:carton.id,unitPrice:780,effectiveFrom:'2026-07-01T00:00:00Z',status:'ACTIVE'},{id:'due-global',targetKey:globalKey,unitPrice:110,effectiveFrom:'2026-08-01T00:00:00Z',status:'SCHEDULED'}])await table(shop,'pos_price_entries').doc(entry.id).set({productId:value.id,variantId:null,productUnitId:null,effectiveTo:null,createdAt:'2026-05-01T00:00:00Z',currencyCode:'MMK',...entry})
  for(const tier of [{id:'global-tier',unitPrice:90,minimumQuantity:'1'},{id:'unit-tier',productUnitId:carton.id,unitPrice:480,minimumQuantity:'10'},{id:'vip-tier',productUnitId:carton.id,priceGroupId:'vip',unitPrice:420,minimumQuantity:'1'}])await table(shop,'pos_price_tiers').doc(tier.id).set({productId:value.id,variantId:null,productUnitId:null,priceGroupId:null,...tier})
  for(const promo of [{id:'priority',type:'PERCENTAGE',value:'10',minimumQuantity:'0',priority:100},{id:'quantity',type:'FIXED_PRICE',value:'50',minimumQuantity:'10',priority:1},{id:'vip-promo',type:'FIXED_PRICE',value:'40',minimumQuantity:'0',priority:200,priceGroupId:'vip',channel:'TIKTOK',discountBase:'REGULAR_PRICE'}])await table(shop,'pos_promotions').doc(promo.id).set({productId:value.id,variantId:null,productUnitId:null,priceGroupId:null,channel:'ALL',name:promo.id,state:'RUNNING',startsAt:'2026-08-01T00:00:00Z',endsAt:'2026-10-01T00:00:00Z',version:1,discountBase:'TIER_PRICE',...promo,targetKey:promotionTargetKey({productId:value.id,...promo})})
  const input={productId:value.id,productUnitId:carton.id,quantity:12,pricingPolicy:'UNIVERSAL_RETAIL',manualDiscount:20}
  const resolved=(await price.read(shop,input)).pricing
  assert.equal(resolved.priceEntryId,'due-global');assert.equal(resolved.regularUnitPrice,660)
  assert.equal(resolved.tierUnitPrice,480);assert.equal(resolved.promotionId,'quantity');assert.equal(resolved.promotionDiscount,180);assert.equal(resolved.finalUnitPrice,280)
  assert.equal((await table(shop,'pos_products').doc(value.id).get()).data().price,100)
  assert.equal((await table(shop,'pos_price_entries').doc('due-global').get()).data().status,'SCHEDULED')
  const legacyResolved=(await price.read(shop,{...input,pricingPolicy:undefined,priceGroupId:'vip',channel:'TIKTOK',manualDiscount:0})).pricing
  assert.equal(legacyResolved.tierUnitPrice,420);assert.equal(legacyResolved.promotionId,'vip-promo');assert.equal(legacyResolved.promotionDiscount,420);assert.equal(legacyResolved.finalUnitPrice,0)
  await assert.rejects(price.read(shop,{...input,manualDiscount:301}),{status:400})
  await assert.rejects(adapter.create(shop,checkout(value.id,100,{items:[{productId:value.id,unitId:carton.unitId,quantity:100}],initialPayment:{method:'Cash',amount:60000}}),'demo-owner',randomUUID(),{checkout:true}),{status:400})
  assert.equal((await table(shop,'pos_price_entries').doc('due-global').get()).data().status,'SCHEDULED')
  const customerId='vip-customer';await table(shop,'pos_customers').doc(customerId).set({id:customerId,shopId:shop,name:'VIP',priceGroupId:'vip'})
  const created=await adapter.create(shop,{customerId,fulfillmentStatus:'preorder',source:'TikTok',items:[{productId:value.id,unitId:carton.unitId,quantity:2}]},'demo-owner',randomUUID())
  assert.equal(created.order.total,0);assert.equal(created.order.items[0].baseQuantity,'12');assert.equal(created.order.items[0].enteredQuantity,'2')
  assert.equal((await table(shop,'pos_products').doc(value.id).get()).data().price,110)
  assert.equal((await table(shop,'pos_price_entries').doc('old-global').get()).data().status,'EXPIRED')
  assert.equal((await table(shop,'pos_price_entries').doc('due-global').get()).data().previousUnitPrice,100)
  assert.equal((await table(shop,'pos_price_entries').doc('old-unit').get()).data().status,'ACTIVE')
})

test('multi-line checkout groups repeated scopes, slices FIFO per item and rolls back customer/payment/sequence on a later shortage',async()=>{
  const shop='orders-atomic-'+randomUUID(),value=await product(shop,2)
  const second=await ledger.receive(shop,{productId:value.id,quantity:2,unitCost:200,receivedAt:'2099-01-01T00:00:00Z'},'demo-owner',randomUUID())
  const missing=await product(shop,1),before=(await table(shop,'stock_balances').doc(stockScopeKey(value.id)).get()).data(),requestsBefore=(await table(shop,'pos_requests').get()).size,auditsBefore=(await table(shop,'pos_audit').get()).size
  const dressIsLast=stockScopeKey(value.id)>stockScopeKey(missing.id)
  await assert.rejects(orders.create(shop,{customer:{name:'Must roll back'},items:[{productId:value.id,quantity:dressIsLast?5:1},{productId:missing.id,quantity:dressIsLast?1:2}],initialPayment:{method:'Cash',amount:100}},'demo-owner',randomUUID()),{status:400})
  for(const name of ['pos_customers','pos_orders','pos_payments','pos_order_numbers','stock_reservations'])assert.equal((await table(shop,name).get()).size,0,name)
  assert.equal((await table(shop,'pos_requests').get()).size,requestsBefore);assert.equal((await table(shop,'pos_audit').get()).size,auditsBefore)
  assert.equal((await table(shop,'pos_shop_meta').doc('main').get()).exists,false)
  assert.deepEqual((await table(shop,'stock_balances').doc(stockScopeKey(value.id)).get()).data(),before)
  const body=checkout(value.id,3,{items:[{productId:value.id,quantity:1.5},{productId:value.id,quantity:1.5}]})
  const key=randomUUID(),result=await orders.create(shop,body,'demo-owner',key,{checkout:true}),items=result.order.items
  assert.equal(result.order.total,600);assert.deepEqual(items.map((item)=>item.unitCost),[100,167])
  assert.equal(items[0].allocations.length,1);assert.deepEqual(items[1].allocations.map((allocation)=>allocation.baseQuantity),['0.5','1'])
  assert.equal(items[1].allocations[1].inventoryBatchId,second.inventoryBatch.id)
  assert.equal((await table(shop,'stock_reservations').where('sourceId','==',result.order.id).get()).size,1)
  const movements=(await table(shop,'stock_movements').where('direction','==','OUT').get()).docs.map((row)=>row.data())
  assert.equal(movements.length,3);assert.ok(movements.every((row)=>row.idempotencyKey===key+':sale:'+row.sourceId))
  assert.equal((await orders.create(shop,body,'demo-owner',key,{checkout:true})).order.id,result.order.id)
})

test('checkout payment modes, saved recipient snapshots and shop settings match source defaults without changing historical data',async()=>{
  const shop='checkout-modes-'+randomUUID(),value=await product(shop,20),settings=createPosSettings({db}),customer={id:'customer',shopId:shop,name:'Demo customer',phone:'09999999',address:'Demo street',city:'Yangon'}
  await table(shop,'pos_customers').doc(customer.id).set(customer)
  const defaults=await settings.save(shop);assert.deepEqual(defaults.settings.paymentMethods.map((method)=>method.name),['Cash'])
  const configured=await settings.save(shop,{paymentMethods:[{id:'cash',name:'Fake Cash'},{id:'cod',name:'COD',type:'cod'},{id:'bank',name:'Demo Bank',sortOrder:2},{id:'BANK',name:'Duplicate'},{id:'disabled',name:'Disabled',active:false}],option1Values:[' Brown ','Brown','Black'],defaultSaleType:'ONLINE'})
  assert.deepEqual(configured.settings.paymentMethods.map((method)=>method.name),['Cash','Disabled','Demo Bank']);assert.deepEqual(configured.settings.option1Values,['Brown','Black'])
  for(const invalid of [checkout(value.id,1,{paymentMode:'COD'}),checkout(value.id,1,{paymentMode:'PARTIAL',initialPayment:{method:'Cash',amount:100}}),checkout(value.id,1,{customerId:customer.id,initialPayment:{method:'Disabled',amount:200}}),checkout(value.id,1,{customerId:customer.id,paymentMode:'PARTIAL',initialPayment:{method:'Cash',amount:200}})])await assert.rejects(orders.create(shop,invalid,'demo-owner',randomUUID(),{checkout:true}),{status:400})
  for(const [paymentMode,amount,cod] of [['FULL',200,0],['PARTIAL',50,0],['UNPAID',0,0],['COD',0,200],['PARTIAL_COD',50,150]]){
    const result=await orders.create(shop,{saleType:'ONLINE',paymentMode,customerId:customer.id,source:'Telegram',items:[{productId:value.id,quantity:1}],...(amount?{initialPayment:{method:'Demo Bank',amount}}:{})},'demo-owner',randomUUID(),{checkout:true}),order=result.order
    assert.equal(order.fulfillmentStatus,'reserved');assert.equal(order.codCollectAmount,cod);assert.equal(order.collectionArrangement,['COD','PARTIAL_COD'].includes(paymentMode)?'COD':'DIRECT')
    assert.equal(order.recipientSnapshot.address,customer.address);assert.equal(order.payments.length,amount?1:0)
    assert.equal((await table(shop,'pos_order_operations').where('orderId','==',order.id).get()).docs[0].data().status,'PENDING')
  }
  await table(shop,'pos_customers').doc(customer.id).update({address:'Changed contact address'})
  const online=(await table(shop,'pos_orders').get()).docs[0].data();assert.equal((await orders.get(shop,online.id)).order.recipientSnapshot.address,'Demo street')
})

test('real POS and public checkouts contend on one stock authority; duplicate checkout retries create one order/payment',async()=>{
  const shop='checkout-race-'+randomUUID(),value=await product(shop,2),key=randomUUID(),body=checkout(value.id,1)
  const retries=await Promise.all([orders.create(shop,body,'demo-owner',key,{checkout:true}),orders.create(shop,body,'demo-owner',key,{checkout:true})])
  assert.equal(retries[0].order.id,retries[1].order.id);assert.equal(retries.filter((row)=>row.replayed).length,1)
  assert.equal((await table(shop,'pos_payments').get()).size,1)
  const publicProduct=normalizeProduct({name:'Public linked dress',slug:'public-linked',status:'published',variants:[{color:'Brown',size:'M',sku:'PUBLIC',price:200,active:true}]},null,shop),variantId=publicProduct.variants[0].id
  await table(shop,'products').doc(publicProduct.id).set(publicProduct)
  await createShopStock({db}).bind(shop,{public_product_id:publicProduct.id,public_variant_id:variantId,pos_product_id:value.id},'demo-owner')
  const publicOrders=createOrderService({db,checkoutEnabled:true}),publicBody={request_key:randomUUID(),tracking_token:'c'.repeat(64),customer:{name:'Guest',phone:'09999999',address:'Guest street',city:'Yangon'},items:[{variant_id:variantId,quantity:1}]}
  const competing=await Promise.allSettled([orders.create(shop,checkout(value.id,1),'demo-owner',randomUUID(),{checkout:true}),publicOrders.checkout(shop,publicBody)])
  assert.equal(competing.filter((row)=>row.status==='fulfilled').length,1,JSON.stringify(competing))
  const rejected=competing.find((row)=>row.status==='rejected');assert.ok([400,409].includes(rejected.reason.status),rejected.reason.stack)
  const balance=(await table(shop,'stock_balances').doc(stockScopeKey(value.id)).get()).data();assert.ok(Number(balance.onHand)-Number(balance.reserved)>=0)
})

test('real customer deletion versus checkout cannot leave an orphaned order or partial stock/payment writes',async()=>{
  const contacts=createPosContacts({db})
  for(let i=0;i<3;i++){
    const shop='customer-checkout-race-'+randomUUID(),value=await product(shop,1),customer=(await contacts.saveCustomer(shop,null,{name:'Race customer'},'demo-owner')).customer
    const result=await Promise.allSettled([contacts.removeCustomer(shop,customer.id,'demo-owner'),orders.create(shop,checkout(value.id,1,{customerId:customer.id}),'demo-owner',randomUUID(),{checkout:true})])
    assert.equal(result.filter((row)=>row.status==='fulfilled').length,1)
    const remainingCustomer=(await table(shop,'pos_customers').doc(customer.id).get()).exists,created=(await table(shop,'pos_orders').get()).docs,payments=(await table(shop,'pos_payments').get()).size,balance=(await table(shop,'stock_balances').doc(stockScopeKey(value.id)).get()).data()
    if(result[1].status==='fulfilled'){assert.ok(remainingCustomer);assert.equal(created.length,1);assert.equal(payments,1);assert.equal(balance.onHand,'0');assert.equal(result[0].reason.status,409)}
    else{assert.equal(remainingCustomer,false);assert.equal(created.length,0);assert.equal(payments,0);assert.equal(balance.onHand,'1');assert.equal(balance.reserved,'0');assert.equal(result[1].reason.status,404)}
  }
})

test('order list matches source summary/full paging, search branches, returns, cancelled amounts and Myanmar date boundaries',async()=>{
  const shop='order-list-'+randomUUID(),value=await product(shop,20),customer={id:'customer',shopId:shop,name:'Current customer',phone:'099999',address:'Street'}
  await table(shop,'pos_customers').doc(customer.id).set(customer)
  const completed=(await orders.create(shop,checkout(value.id,1,{customerId:customer.id}),'demo-owner',randomUUID(),{checkout:true})).order
  const unpaid=(await orders.create(shop,{saleType:'ONLINE',paymentMode:'COD',customerId:customer.id,items:[{productId:value.id,quantity:1}],source:'Telegram'},'demo-owner',randomUUID(),{checkout:true})).order
  const partial=(await orders.create(shop,{customerId:customer.id,items:[{productId:value.id,quantity:1}],discount:40,initialPayment:{method:'Cash',amount:40}},'demo-owner',randomUUID())).order
  const cancelled=(await orders.create(shop,{fulfillmentStatus:'preorder',items:[{productId:value.id,quantity:1}]},'demo-owner',randomUUID())).order
  await table(shop,'pos_orders').doc(completed.id).update({createdAt:'2026-10-01T18:00:00Z'})
  await table(shop,'pos_orders').doc(cancelled.id).update({fulfillmentStatus:'cancelled',cancelledAt:'2026-10-02T12:00:00Z'})
  // Seeded returns/operation states verify readers; their write APIs are pending.
  await table(shop,'pos_customer_returns').doc('returned').set({id:'returned',orderId:partial.id,orderItemId:partial.items[0].id,quantity:'0.5',condition:'SELLABLE',reason:'Fixture',createdAt:'2026-10-02T12:00:00Z'})
  const operation=(await table(shop,'pos_order_operations').where('orderId','==',unpaid.id).get()).docs[0];await operation.ref.update({status:'READY'})
  const plain=await orders.list(shop,{paged:'true',view:'summary',pageSize:'25',sort:'total',direction:'asc'})
  assert.equal(plain.totalCount,4);assert.equal(plain.summary.amount,480);assert.equal(plain.summary.count,4)
  assert.equal(plain.orders.find((row)=>row.id===partial.id).effectiveTotal,80)
  assert.equal(plain.orders[0].items[0].product,undefined);assert.equal(plain.orders.find((row)=>row.id===completed.id).customer.name,customer.name)
  const full=await orders.list(shop,{view:'full',search:value.name});assert.equal(full.totalCount,4);assert.equal(full.orders[0].items[0].product.id,value.id)
  const preparing=await orders.list(shop,{paged:'true',orderStatus:'ready',paymentStatus:'unpaid'});assert.equal(preparing.totalCount,1);assert.equal(preparing.orders[0].id,unpaid.id)
  const paid=await orders.list(shop,{paged:'true',paymentStatus:'paid'});assert.equal(paid.totalCount,1);assert.equal(paid.orders[0].id,completed.id)
  assert.equal((await orders.list(shop,{paged:'true',search:'Cash'})).totalCount,1)
  assert.equal((await orders.list(shop,{search:'Cash'})).totalCount,2)
  const cancelledFilter=await orders.list(shop,{paged:'true',orderStatus:'cancelled'});assert.equal(cancelledFilter.totalCount,1);assert.equal(cancelledFilter.summary.amount,0)
  assert.equal((await orders.list(shop,{paged:'true',orderStatus:'cancelled',paymentStatus:'unpaid'})).totalCount,0)
  assert.equal((await orders.list(shop,{from:'2026-10-02',to:'2026-10-02',search:completed.orderNumber})).totalCount,1)
  assert.equal((await orders.list(shop,{from:'2026-10-01',to:'2026-10-01',search:completed.orderNumber})).totalCount,0)
  await assert.rejects(orders.list(shop,{from:'2026-02-30'}),{status:400})
  await assert.rejects(orders.list(shop,{from:'2026-10-03',to:'2026-10-01'}),{status:400})
  await assert.rejects(orders.list(shop,{pageSize:26}),{status:400})
  const byComplete=await orders.list(shop,{view:'summary',sort:'completedAt',direction:'asc'});assert.equal(byComplete.orders[0].id,completed.id)
})

test('direct payment HTTP rejects stale methods, preserves idempotency and immutable originals, settles remaining credit and updates list/detail receipt',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example'),value=await product('belle-online',5),customer=(await http('customers','POST',{name:'Payment customer '+randomUUID(),phone:'099999',address:'Demo street'},owner)).data.customer
  const created=await http('orders/checkout','POST',checkout(value.id,1,{customerId:customer.id,paymentMode:'PARTIAL',initialPayment:{method:'Cash',amount:50}}),owner,randomUUID());assert.equal(created.status,201)
  const order=created.data.order,key=randomUUID(),url='orders/'+order.id+'/payments',body={method:'Cash',scope:'advanced-payment',amount:50,paidAt:'2026-10-02T00:00:00Z',note:'Append-only collection'}
  const originalPayment=(await table('belle-online','pos_payments').doc(order.payments[0].id).get()).data(),originalMovements=(await table('belle-online','stock_movements').where('productId','==',value.id).get()).docs.map((row)=>row.data())
  assert.equal((await http(url,'POST',body)).status,401);assert.equal((await http(url,'POST',body,other)).status,403)
  assert.equal((await http(url,'POST',{method:'Cash',scope:'credit-settlement',amount:50},owner,randomUUID())).status,400)
  const stale=await http(url,'POST',{...body,method:'COD'},owner,randomUUID());assert.equal(stale.status,409);assert.equal(stale.data.code,'PAYMENT_METHOD_CHANGED')
  const result=await http(url,'POST',body,owner,key);assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.order.paymentStatus,'partial');assert.equal(result.data.payment.amount,50);assert.deepEqual(result.data.payment.allocations,[])
  assert.deepEqual((await http(url,'POST',body,owner,key)).data,result.data)
  assert.equal((await http(url,'POST',{...body,note:'Different'},owner,key)).status,409)
  const final=await http(url,'POST',{method:'Cash',scope:'credit-settlement'},owner,randomUUID());assert.equal(final.status,201);assert.equal(final.data.payment.amount,100);assert.equal(final.data.order.paymentStatus,'paid');assert.equal(final.data.order.paymentTracking,true)
  assert.equal((await http(url,'POST',{method:'Cash'},owner,randomUUID())).status,400)
  assert.deepEqual((await table('belle-online','pos_payments').doc(order.payments[0].id).get()).data(),originalPayment)
  assert.deepEqual((await table('belle-online','stock_movements').where('productId','==',value.id).get()).docs.map((row)=>row.data()),originalMovements)
  const detail=await http('orders/'+order.id,'GET',undefined,owner);assert.equal(detail.status,200);assert.equal(detail.data.receipt.totals.paid,200);assert.equal(detail.data.receipt.totals.outstanding,0);assert.equal(detail.data.receipt.items[0].displayQuantity,1);assert.equal(detail.data.receipt.items[0].unitName,'Piece')
  const list=await http('orders?paged=true&view=summary&search='+order.orderNumber,'GET',undefined,owner);assert.equal(list.data.orders[0].paymentStatus,'paid')
  const payments=await http('payments','GET',undefined,owner);assert.equal(payments.status,200);assert.equal(payments.data.payments.filter((payment)=>payment.orderId===order.id).length,3)
})

test('competing final collections and cross-order payment references serialize while return/cancel balances fail closed',async()=>{
  const shop='payments-race-'+randomUUID(),adapter=createPosPayments({db}),value=await product(shop,20)
  const create=async()=> (await orders.create(shop,{items:[{productId:value.id,quantity:1}]},'demo-owner',randomUUID())).order
  const first=await create(),key=randomUUID(),body={method:'Cash',scope:'credit-settlement'}
  const duplicate=await Promise.all([adapter.receive(shop,first.id,body,'demo-owner',key),adapter.receive(shop,first.id,body,'demo-owner',key)])
  assert.equal(duplicate[0].payment.id,duplicate[1].payment.id);assert.equal((await table(shop,'pos_payments').where('orderId','==',first.id).get()).size,1)
  const second=await create(),racing=await Promise.allSettled([adapter.receive(shop,second.id,body,'demo-owner',randomUUID()),adapter.receive(shop,second.id,body,'demo-owner',randomUUID())])
  assert.equal(racing.filter((row)=>row.status==='fulfilled').length,1);assert.equal(racing.find((row)=>row.status==='rejected').reason.status,400)
  const third=await create(),fourth=await create(),ref='REFERENCE-'+randomUUID(),referenceRace=await Promise.allSettled([third,fourth].map((order)=>adapter.receive(shop,order.id,{method:'Cash',transactionId:ref,billNumber:'BILL'},'demo-owner',randomUUID())))
  assert.equal(referenceRace.filter((row)=>row.status==='fulfilled').length,1);assert.equal(referenceRace.find((row)=>row.status==='rejected').reason.status,400)
  const cancelled=await create();await table(shop,'pos_orders').doc(cancelled.id).update({cancellationState:'RETURN_PENDING'})
  await assert.rejects(adapter.receive(shop,cancelled.id,body,'demo-owner',randomUUID()),{status:409,code:'ORDER_RETURN_PENDING'})
  const returned=await create();await table(shop,'pos_customer_returns').doc('return-half').set({id:'return-half',orderId:returned.id,orderItemId:returned.items[0].id,quantity:'0.5'})
  const allocated={id:'allocated',type:'payment',scope:'cod-settlement',amount:20,allocations:JSON.stringify([{orderId:returned.id,amount:20}]),orderIds:JSON.stringify([returned.id])};await table(shop,'pos_payments').doc(allocated.id).set(allocated)
  const paid=await adapter.receive(shop,returned.id,body,'demo-owner',randomUUID());assert.equal(paid.payment.amount,80);assert.equal(paid.order.paymentStatus,'paid')
  assert.deepEqual((await table(shop,'pos_payments').doc(allocated.id).get()).data(),allocated)
  const zero=await create();await table(shop,'pos_customer_returns').doc('return-full').set({id:'return-full',orderId:zero.id,orderItemId:zero.items[0].id,quantity:'1'})
  await assert.rejects(adapter.receive(shop,zero.id,body,'demo-owner',randomUUID()),{status:400})
  const onlineCustomer={id:'online-customer',shopId:shop,name:'Online',phone:'099999',address:'Street'};await table(shop,'pos_customers').doc(onlineCustomer.id).set(onlineCustomer)
  const cod=(await orders.create(shop,{saleType:'ONLINE',paymentMode:'COD',customerId:onlineCustomer.id,items:[{productId:value.id,quantity:1}]},'demo-owner',randomUUID(),{checkout:true})).order
  await adapter.receive(shop,cod.id,{method:'Cash',amount:50},'demo-owner',randomUUID());assert.equal((await table(shop,'pos_orders').doc(cod.id).get()).data().codCollectAmount,150)
})
