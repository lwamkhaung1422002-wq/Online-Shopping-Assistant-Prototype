import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {createPosOrders} from '../../BelleLocal POS app/functions/src/pos/orders.js'
import {createPosCatalog} from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import {createPosOperations} from '../../BelleLocal POS app/functions/src/pos/operations.js'
import {createPosCodReceipts} from '../../BelleLocal POS app/functions/src/pos/cod-receipts.js'
import {createPosPayments} from '../../BelleLocal POS app/functions/src/pos/payments.js'
import {stockScopeKey} from '../../BelleLocal POS app/functions/src/pos/stock-ledger.js'
import {signatureFixture} from './handover-signature-fixture.mjs'
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Operations tests require the isolated loopback emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url)),{initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
initializeApp({projectId:'demo-belle-online'});const db=getFirestore(),auth=getAuth(),orders=createPosOrders({db}),catalog=createPosCatalog({db}),operations=createPosOperations({db,getCreatorName:async()=> 'Trusted operation owner'}),cod=createPosCodReceipts({db}),payments=createPosPayments({db})
const table=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`),rows=async(shop,name)=>(await table(shop,name).get()).docs.map((row)=>row.data()),base='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
async function token(uid,email){try{await auth.createUser({uid,email,password:'Local-test-only-123!',displayName:'Demo Belle Owner'})}catch(error){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(error.code))throw error}const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});return (await response.json()).idToken}
async function http(path,method,owner,body,key){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer '+owner}:{}),...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()}}
async function setup(shop,quantity=50){const customer={id:'customer',name:'Saved buyer',phone:'099999',address:'Original address'};await table(shop,'pos_customers').doc(customer.id).set(customer);return catalog.create(shop,{name:'Operation dress '+randomUUID(),price:9000,cost:4000,units:[{name:'Piece',isBase:true,conversionFactor:1}],openingStock:{quantity,unitCost:4000}},'demo-owner',randomUUID())}
async function checkout(shop,product,extra={}){return (await orders.create(shop,{saleType:'ONLINE',paymentMode:'COD',customerId:'customer',items:[{productId:product.id,quantity:1}],...extra},'demo-owner',randomUUID(),{checkout:true})).order}
async function prepare(shop,order){await operations.advance(shop,order.id,'start','demo-owner');for(const item of order.items)await operations.setPrepared(shop,order.id,item.id,{prepared:true},'demo-owner');await operations.advance(shop,order.id,'ready','demo-owner')}
const delivery=(invoices,extra={})=>({orderIds:invoices.map((order)=>order.id),receiverName:'Courier receiver',receiverPhone:'099555',signatureDataUrl:signatureFixture(),verifiedItems:invoices.flatMap((order)=>order.items.map((item)=>({orderItemId:item.id,quantity:String(Number(item.enteredQuantity??item.quantity)),unit:item.pricingSnapshot?.unitSymbol??''}))),...extra})
const sorted=(values)=>values.sort((a,b)=>String(a.id).localeCompare(String(b.id)))

test('Operation HTTP requires owner, persists checklist, freezes Ready, rejects completion bypass and creates a real COD-eligible delivery',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example'),product=await setup('belle-online'),order=await checkout('belle-online',product,{paymentMode:'PARTIAL_COD',initialPayment:{method:'Cash',amount:5000}})
  assert.equal((await http('order-operations','GET')).status,401);assert.equal((await http('order-operations','GET',other)).status,403)
  assert.equal((await http('order-operations/'+order.id+'/ready','POST',owner,{})).status,409)
  assert.equal((await http('order-operations/'+order.id+'/start','POST',owner,{})).status,200)
  assert.equal((await http('order-operations/'+order.id+'/start','POST',owner,{})).status,200)
  assert.equal((await http('order-operations/'+order.id+'/ready','POST',owner,{})).status,400)
  assert.equal((await http('order-operations/'+order.id+'/items/'+order.items[0].id,'PUT',owner,{prepared:true})).status,200)
  assert.equal((await http('order-operations/'+order.id+'/ready','POST',owner,{})).status,200)
  assert.equal((await http('order-operations/'+order.id+'/ready','POST',owner,{})).status,200)
  assert.equal((await http('order-operations/'+order.id+'/items/'+order.items[0].id,'PUT',owner,{prepared:false})).status,400)
  assert.equal((await http('orders/'+order.id+'/status','PATCH',owner,{fulfillmentStatus:'completed'})).status,400)
  assert.equal((await http('delivery-handovers','POST',owner,delivery([order]))).status,400)
  const key=randomUUID(),created=await http('delivery-handovers','POST',owner,delivery([order]),key);assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.handover.createdByName,'Demo Belle Owner');assert.equal(created.data.handover.orders[0].snapshot.codPending,4000)
  const replay=await http('delivery-handovers','POST',owner,delivery([order]),key);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(replay.data.handover.id,created.data.handover.id)
  const detail=await http('delivery-handovers/'+created.data.handover.id,'GET',owner);assert.equal(detail.data.handover.orders[0].order.fulfillmentStatus,'completed')
  const pending=await http('payments/cod-pending?search='+order.orderNumber,'GET',owner);assert.equal(pending.data.invoices[0].remainingAmount,4000)
  const invoice=await http('orders/'+order.id,'GET',owner);assert.deepEqual(invoice.data.operationActivity.events.map((event)=>event.toStatus),['PENDING','PREPARING','READY','COMPLETED'])
})

test('Mixed five-mode delivery consumes shared FIFO balances once, freezes saved snapshots and leaves original payments and all legacy tables unchanged',async()=>{
  const shop='operations-mixed-'+randomUUID(),product=await setup(shop,20),invoices=[]
  for(const [paymentMode,amount] of [['FULL',9000],['PARTIAL',5000],['COD',0],['PARTIAL_COD',5000],['UNPAID',0]]){const order=await checkout(shop,product,{paymentMode,...(amount?{initialPayment:{method:'Cash',amount}}:{})});await prepare(shop,order);invoices.push(order)}
  const originalPayments=sorted(await rows(shop,'pos_payments')),legacyNames=['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta'],legacyKey=randomUUID(),original={amount:34500,paid:false}
  for(const name of legacyNames)await db.doc('users/demo-owner/'+name+'/'+legacyKey).set(original)
  const scope=stockScopeKey(product.id),before=(await table(shop,'stock_balances').doc(scope).get()).data();assert.equal(before.onHand,'20');assert.equal(before.reserved,'5')
  const created=await operations.createDelivery(shop,delivery(invoices),'demo-owner',randomUUID());assert.equal(created.handover.orders.length,5);assert.match(created.handover.deliveryNumber,/^DLV-\d{5}$/)
  const balance=(await table(shop,'stock_balances').doc(scope).get()).data();assert.equal(balance.onHand,'15');assert.equal(balance.reserved,'0')
  assert.equal((await rows(shop,'stock_movements')).filter((row)=>row.type==='SALE').length,5)
  assert.deepEqual(sorted(await rows(shop,'pos_payments')),originalPayments)
  for(const order of invoices){assert.equal((await orders.get(shop,order.id)).order.fulfillmentStatus,'completed');assert.equal((await operations.get(shop,order.id)).operation.status,'COMPLETED')}
  assert.deepEqual(created.handover.orders.map((entry)=>[entry.snapshot.paymentMode,entry.snapshot.remainingAmount]).sort(),[['COD',9000],['FULL',0],['PARTIAL',4000],['PARTIAL_COD',4000],['UNPAID',9000]].sort())
  await table(shop,'pos_customers').doc('customer').update({name:'Edited later',address:'Changed address'})
  const saved=(await operations.handoverGet(shop,created.handover.id)).handover;for(const member of saved.orders)assert.equal(member.snapshot.customer.name,'Saved buyer')
  assert.equal((await operations.list(shop,{status:'READY'})).pagination.total,0);assert.equal((await operations.list(shop,{status:'COMPLETED',search:created.handover.deliveryNumber.toLowerCase()})).pagination.total,1)
  const codOrder=invoices.find((order)=>order.paymentMode==='PARTIAL_COD'),receipt=await cod.receive(shop,{receivingMethod:'Cash',statementNumber:'123456',transactionId:'654321',paymentDate:'2026-10-11',amount:4000,allocations:[{orderId:codOrder.id,expectedBalance:4000}]},'demo-owner',randomUUID());assert.equal(receipt.settlement.amount,4000)
  for(const name of legacyNames)assert.deepEqual((await db.doc('users/demo-owner/'+name+'/'+legacyKey).get()).data(),original)
})

test('Handover rejects blank signatures, changed item evidence, non-Ready and foreign invoices and rolls back an earlier stock plan if a later scope is corrupt',async()=>{
  const shop='operations-rollback-'+randomUUID(),product=await setup(shop),other=await setup(shop),first=await checkout(shop,product),second=await checkout(shop,other),pending=await checkout(shop,product);await prepare(shop,first);await prepare(shop,second)
  const tables=['pos_orders','pos_order_operations','pos_delivery_handovers','pos_delivery_keys','pos_delivery_memberships','stock_balances','stock_batches','stock_reservations','stock_movements','stock_requests','pos_audit','pos_shop_meta'],snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async(name)=>[name,sorted(await rows(shop,name))])))
  let before=await snapshot()
  for(const body of [delivery([first],{receiverName:' '}),delivery([first],{signatureDataUrl:signatureFixture(false)}),delivery([first],{verifiedItems:[]}),delivery([first],{verifiedItems:[{orderItemId:first.items[0].id,quantity:'2',unit:first.items[0].pricingSnapshot.unitSymbol}]}),delivery([first],{orderIds:[first.id,first.id]})])await assert.rejects(operations.createDelivery(shop,body,'demo-owner',randomUUID()),{status:400})
  await assert.rejects(operations.createDelivery(shop,delivery([first,pending]),'demo-owner',randomUUID()),{code:'OPERATION_CHANGED'});await assert.rejects(operations.createDelivery(shop,delivery([first],{orderIds:[first.id,'foreign']}),'demo-owner',randomUUID()),{status:404});assert.deepEqual(await snapshot(),before)
  const sortedOrders=[first,second].sort((a,b)=>a.id.localeCompare(b.id)),last=sortedOrders[1];await table(shop,'stock_balances').doc(stockScopeKey(last.items[0].productId)).update({onHand:'999'});before=await snapshot()
  await assert.rejects(operations.createDelivery(shop,delivery([first,second]),'demo-owner',randomUUID()),{status:409});assert.deepEqual(await snapshot(),before)
})

test('Concurrent delivery keys and ordinary collection serialize without duplicate memberships, movements or sequence; changed-key replay conflicts',async()=>{
  const shop='operations-race-'+randomUUID(),product=await setup(shop),order=await checkout(shop,product);await prepare(shop,order)
  const key=randomUUID(),body=delivery([order]),same=await Promise.all([operations.createDelivery(shop,body,'demo-owner',key),operations.createDelivery(shop,body,'demo-owner',key)])
  assert.deepEqual(same.map((value)=>value.replayed).sort(),[false,true]);assert.equal(same[0].handover.id,same[1].handover.id);assert.equal((await rows(shop,'pos_delivery_memberships')).length,1);assert.equal((await rows(shop,'stock_movements')).filter((row)=>row.type==='SALE').length,1)
  await assert.rejects(operations.createDelivery(shop,{...body,receiverPhone:'different'},'demo-owner',key),{code:'IDEMPOTENCY_CONFLICT'})
  const next=await checkout(shop,product);await prepare(shop,next);const outcomes=await Promise.allSettled([operations.createDelivery(shop,delivery([next]),'demo-owner',randomUUID()),operations.createDelivery(shop,delivery([next]),'demo-owner',randomUUID())]);assert.equal(outcomes.filter((row)=>row.status==='fulfilled').length,1);assert.equal(outcomes.find((row)=>row.status==='rejected').reason.code,'OPERATION_CHANGED')
  const third=await checkout(shop,product,{paymentMode:'PARTIAL_COD',initialPayment:{method:'Cash',amount:5000}});await prepare(shop,third)
  const collected=await Promise.all([operations.createDelivery(shop,delivery([third]),'demo-owner',randomUUID()),payments.receive(shop,third.id,{scope:'order-payment',method:'Cash',amount:4000,note:'During delivery'},'demo-owner',randomUUID())]);assert.equal(collected.length,2)
  const snapshot=(await operations.handoverGet(shop,collected[0].handover.id)).handover.orders[0].snapshot;assert.ok([0,4000].includes(snapshot.remainingAmount));assert.equal((await orders.get(shop,third.id)).order.paymentStatus,'paid');assert.equal((await table(shop,'pos_shop_meta').doc('main').get()).data().deliverySequence,3)
})

test('Operation presentation keeps stage segments, complete search/paging and Yangon dates, and retained return handover snapshots',async()=>{
  const shop='operations-list-'+randomUUID(),date='2026-01-15T17:00:00.000Z',batch=db.batch()
  for(let i=0;i<106;i++){const orderId='invoice-'+String(i).padStart(3,'0'),order={id:orderId,shopId:shop,orderNumber:'SEARCH-'+i,saleType:'ONLINE',fulfillmentStatus:'reserved',createdAt:date,customerSnapshot:{name:'Saved '+i},items:[]};batch.create(table(shop,'pos_orders').doc(orderId),order);batch.create(table(shop,'pos_order_operations').doc(orderId),{id:orderId,shopId:shop,orderId,status:i===0?'PREPARING':'PENDING',createdAt:date})}await batch.commit()
  const selected=await operations.list(shop,{search:'search',page:5,pageSize:25});assert.equal(selected.pagination.total,106);assert.equal(selected.entries.length,6);assert.equal((await operations.list(shop,{status:'NOT_READY',pageSize:1})).entries[0].operation.status,'PREPARING')
  assert.equal((await operations.list(shop,{search:'SEARCH-105',from:'2026-01-15',to:'2026-01-15'})).pagination.total,1);assert.equal((await operations.list(shop,{from:'2026-01-16',to:'2026-01-16'})).pagination.total,0)
  await assert.rejects(operations.list(shop,{from:'2026-02-02',to:'2026-01-01'}),{status:400})
  await table(shop,'pos_orders').doc('invoice-000').update({fulfillmentStatus:'completed',cancellationState:'RETURN_PENDING',cancellationRequestedAt:date});await table(shop,'pos_delivery_handovers').doc('group').set({id:'group',deliveryNumber:'DLV-test',receiverName:'Frozen receiver',receiverPhone:'0999',createdByName:'Saved Owner',createdAt:date});await table(shop,'pos_delivery_memberships').doc('invoice-000').set({id:'invoice-000',orderId:'invoice-000',handoverId:'group',snapshot:{orderNumber:'SEARCH-0',customer:{name:'Frozen buyer'}}})
  const pending=await operations.list(shop,{status:'RETURN_PENDING',from:'2026-01-15',to:'2026-01-15'});assert.equal(pending.entries[0].kind,'return');assert.equal(pending.entries[0].operation.status,'RETURN_PENDING')
  assert.equal((await operations.list(shop,{status:'COMPLETED',search:'frozen buyer'})).pagination.total,1);await table(shop,'pos_orders').doc('invoice-000').update({fulfillmentStatus:'cancelled'});assert.equal((await operations.list(shop,{status:'COMPLETED'})).pagination.total,0)
})

test('Ordinary preorder fulfillment reserves FIFO once and explicit completion consumes once while status guards preserve completed and managed invoices',async()=>{
  const shop='operations-preorder-'+randomUUID(),product=await setup(shop,10),preorder=(await orders.create(shop,{fulfillmentStatus:'preorder',items:[{productId:product.id,quantity:2},{productId:product.id,quantity:1}]},'demo-owner',randomUUID())).order,scope=stockScopeKey(product.id)
  assert.equal((await table(shop,'stock_balances').doc(scope).get()).data().reserved,'0');await assert.rejects(operations.updateStatus(shop,preorder.id,{fulfillmentStatus:'completed'},'demo-owner'),{status:400})
  const fulfilled=await operations.fulfill(shop,preorder.id,'demo-owner');assert.equal(fulfilled.order.fulfillmentStatus,'reserved');assert.equal(fulfilled.order.items.reduce((sum,item)=>sum+item.allocations.length,0),2);assert.equal((await table(shop,'stock_balances').doc(scope).get()).data().reserved,'3')
  await assert.rejects(operations.fulfill(shop,preorder.id,'demo-owner'),{status:400});const result=await operations.updateStatus(shop,preorder.id,{fulfillmentStatus:'completed'},'demo-owner');assert.equal(result.order.fulfillmentStatus,'completed');assert.equal((await table(shop,'stock_balances').doc(scope).get()).data().onHand,'7');assert.equal((await rows(shop,'stock_movements')).filter((row)=>row.type==='SALE').length,2)
  await assert.rejects(operations.updateStatus(shop,preorder.id,{fulfillmentStatus:'reserved'},'demo-owner'),{status:400});await assert.rejects(operations.updateStatus(shop,preorder.id,{fulfillmentStatus:'completed'},'demo-owner'),{status:400})
  const online=await checkout(shop,product);await assert.rejects(operations.updateStatus(shop,online.id,{fulfillmentStatus:'completed'},'demo-owner'),{status:400})
})
