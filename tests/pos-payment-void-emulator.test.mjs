import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {createPosCatalog} from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import {createPosOrders} from '../../BelleLocal POS app/functions/src/pos/orders.js'
import {createPosPayments} from '../../BelleLocal POS app/functions/src/pos/payments.js'
import {createShopApi} from '../../BelleLocal POS app/functions/src/online-shop/api.js'

if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Payment void tests require isolated loopback emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url)),{initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
initializeApp({projectId:'demo-belle-online'});const db=getFirestore(),auth=getAuth(),owner='void-owner-'+randomUUID(),catalog=createPosCatalog({db}),orders=createPosOrders({db}),payments=createPosPayments({db})
const table=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`),rows=async(shop,name)=>(await table(shop,name).get()).docs.map(row=>({...row.data(),id:row.id})).sort((a,b)=>a.id.localeCompare(b.id)),read=async(shop,name,key)=>(await table(shop,name).doc(key).get()).data()
const names=['pos_orders','pos_payments','pos_payment_voids','pos_requests','pos_audit','stock_balances','stock_batches','stock_movements','stock_reservations'],state=async shop=>Object.fromEntries(await Promise.all(names.map(async name=>[name,await rows(shop,name)])))
async function fixture(count=2){
 const shop='void-'+randomUUID();await table(shop,'pos_settings').doc('main').set({paymentMethods:[{name:'Cash',active:true,type:'cash'}]});await table(shop,'pos_customers').doc('buyer').set({id:'buyer',shopId:shop,name:'Saved buyer',address:'Saved street',phone:'0999'})
 const product=await catalog.create(shop,{name:'Void dress '+randomUUID(),price:100,cost:30,units:[{name:'Piece',isBase:true,conversionFactor:1}],openingStock:{quantity:count+1,unitCost:30}},owner,randomUUID()),invoices=[]
 for(let i=0;i<count;i++)invoices.push((await orders.create(shop,{saleType:'ONLINE',paymentMode:'COD',customerId:'buyer',items:[{productId:product.id,quantity:1}]},owner,randomUUID(),{checkout:true})).order)
 // The reference's obsolete settlement producer rejects new writes. Persisted
 // source-style allocated settlements remain eligible for its void endpoint.
 const settlement={id:'settlement',shopId:shop,orderId:null,type:'cod-settlement',scope:null,method:'Cash',amount:count*100,billNumber:'123456',transactionId:'654321',orderIds:JSON.stringify(invoices.map(order=>order.id)),allocations:JSON.stringify(invoices.map(order=>({orderId:order.id,amount:100}))),paidAt:'2026-10-10T03:00:00.000Z',createdAt:'2026-10-10T03:00:00.000Z'}
 await table(shop,'pos_payments').doc(settlement.id).set(settlement);return {shop,product,invoices,settlement}
}
async function token(uid){const email=uid+'@example.test';await auth.createUser({uid,email,password:'Local-test-only-123!'});const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});assert.equal(response.status,200);return (await response.json()).idToken}

test('Source allocated COD void reaches actual Auth/API, preserves original receipts/stock, returns exact DTO/audit and reopens invoice balances',async()=>{
 const f=await fixture(),before=await state(f.shop),legacy=db.doc('users/'+owner+'/payments/'+randomUUID()),original={amount:34500,status:'paid',customer:'Original Belle'};await legacy.set(original)
 const handler=createShopApi({db,auth,ownerUid:owner,allowedShopId:f.shop,allowedOrigins:[]}),server=createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');req.path=url.pathname;req.query=Object.fromEntries(url.searchParams);let raw='';for await(const chunk of req)raw+=chunk;req.body=raw?JSON.parse(raw):undefined;res.set=(key,value)=>res.setHeader(key,value);res.status=value=>{res.statusCode=value;return res};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))};res.send=value=>res.end(value);await handler(req,res)})
 server.listen(0,'127.0.0.1');await once(server,'listening');try{
  const bearer=await token(owner),outsider=await token('void-outsider-'+randomUUID()),base=`http://127.0.0.1:${server.address().port}/${f.shop}/admin/pos/`,key=randomUUID(),body={reason:'  Wrong COD settlement  '},send=async(path,identity=bearer,input=body,requestKey=key,method='POST')=>{const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(identity?{Authorization:'Bearer '+identity}:{}),'Idempotency-Key':requestKey},...(method==='DELETE'?{}:{body:JSON.stringify(input)})});return {status:response.status,data:await response.json()}}
  assert.equal((await send('payments/settlement/void',null)).status,401);assert.equal((await send('payments/settlement/void',outsider)).status,403);assert.deepEqual(await state(f.shop),before)
  const orderPath='orders/'+f.invoices[0].id;assert.equal((await send(orderPath,null,{},key,'DELETE')).status,401);assert.equal((await send(orderPath,outsider,{},key,'DELETE')).status,403);const deletion=await send(orderPath,bearer,{},key,'DELETE');assert.equal(deletion.status,400);assert.match(deletion.data.error,/Sale records are retained/);assert.equal((await send('orders/missing',bearer,{},key,'DELETE')).status,404);assert.deepEqual(await state(f.shop),before)
  const result=await send('payments/settlement/void');assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.payment.amount,-200);assert.equal(result.data.payment.reason,'Wrong COD settlement');assert.equal(result.data.payment.originalPaymentId,'settlement');assert.equal(result.data.payment.billNumber,'123456');assert.deepEqual(result.data.payment.orderIds,f.invoices.map(order=>order.id));assert.deepEqual(result.data.payment.allocations,JSON.parse(f.settlement.allocations))
  assert.ok(result.data.orders.every(order=>order.paymentStatus==='unpaid'&&order.codCollectAmount===100));assert.deepEqual((await send('payments/settlement/void')).data,result.data)
  assert.equal((await send('payments/settlement/void',bearer,{reason:'different'})).status,409);assert.equal((await send('payments/settlement/void',bearer,body,randomUUID())).status,400)
  assert.deepEqual(await read(f.shop,'pos_payments','settlement'),f.settlement);for(const name of ['stock_balances','stock_batches','stock_movements','stock_reservations'])assert.deepEqual(await rows(f.shop,name),before[name]);assert.deepEqual((await legacy.get()).data(),original)
  const audit=(await rows(f.shop,'pos_audit')).filter(row=>row.action==='payment.codSettlementVoid');assert.equal(audit.length,1);assert.equal(audit[0].entity,'Payment');assert.equal(audit[0].entityId,result.data.payment.id);assert.equal((await rows(f.shop,'pos_payment_voids')).length,1)
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})

test('Source void guards direct/canonical/non-settlement payments, duplicate persisted void, missing final invoice and returning online invoice atomically',async()=>{
 for(const condition of ['ordinary','cod-receipt','already-void','missing-last','return-pending']){
  const f=await fixture();if(condition==='ordinary'||condition==='cod-receipt')await table(f.shop,'pos_payments').doc('settlement').update({scope:condition==='ordinary'?'order-payment':'cod-receipt'})
  if(condition==='already-void')await table(f.shop,'pos_payments').doc('old-void').set({id:'old-void',scope:'cod-settlement-void',originalPaymentId:'settlement',amount:-200})
  if(condition==='missing-last')await table(f.shop,'pos_orders').doc(f.invoices[1].id).delete()
  if(condition==='return-pending')await table(f.shop,'pos_orders').doc(f.invoices[1].id).update({cancellationState:'RETURN_PENDING'})
  const before=await state(f.shop);await assert.rejects(payments.voidSettlement(f.shop,'settlement',{reason:'Correction'},owner,randomUUID()),condition==='return-pending'?{status:409,code:'ORDER_RETURN_PENDING'}:{status:condition==='missing-last'?404:400});assert.deepEqual(await state(f.shop),before)
 }
 const f=await fixture(1),before=await state(f.shop);await assert.rejects(payments.voidSettlement(f.shop,'settlement',{reason:' '},owner,randomUUID()),{status:400});await assert.rejects(payments.voidSettlement(f.shop,'absent',{reason:'Correction'},owner,randomUUID()),{status:404});assert.deepEqual(await state(f.shop),before)
})

test('Source void uses historical discounted return value and direct/other allocated payments, preserves substring identity and malformed-array source behavior',async()=>{
 const f=await fixture(1),order=f.invoices[0];await table(f.shop,'pos_orders').doc(order.id).update({subtotal:100,discount:20,total:80});await table(f.shop,'pos_customer_returns').doc('half').set({id:'half',orderId:order.id,orderItemId:order.items[0].id,quantity:'0.5'})
 await table(f.shop,'pos_payments').doc('direct').set({id:'direct',orderId:order.id,type:'payment',scope:'order-payment',method:'Cash',amount:20,paidAt:f.settlement.paidAt,createdAt:f.settlement.createdAt});await table(f.shop,'pos_payments').doc('other').set({id:'other',orderId:null,type:'cod-settlement',amount:15,orderIds:JSON.stringify([order.id]),allocations:JSON.stringify([{orderId:order.id,amount:15}])});await table(f.shop,'pos_payments').doc('substring').set({id:'substring',orderId:null,amount:999,orderIds:JSON.stringify([order.id+'extra']),allocations:JSON.stringify([{orderId:order.id+'extra',amount:999}])})
 const result=await payments.voidSettlement(f.shop,'settlement',{reason:'Correct source allocation'},owner);assert.equal(result.orders[0].paymentStatus,'partial');assert.equal(result.orders[0].codCollectAmount,5);assert.equal(result.orders[0].payments.length,1);assert.equal(result.orders[0].items[0].returns[0].quantity,'0.5');assert.deepEqual(await read(f.shop,'pos_payments','direct'),result.orders[0].payments[0])
 const malformed=await fixture(1);await table(malformed.shop,'pos_payments').doc('settlement').update({orderIds:'invalid JSON',allocations:'invalid JSON'});const empty=await payments.voidSettlement(malformed.shop,'settlement',{reason:'Source malformed allocation'},owner);assert.deepEqual(empty.orders,[]);assert.deepEqual(empty.payment.orderIds,[]);assert.deepEqual(empty.payment.allocations,[])
})

test('Concurrent source voids append once and payment collection versus void serializes to the same conserved final invoice balance',async()=>{
 const f=await fixture(1),key=randomUUID(),body={reason:'Concurrent correction'},duplicate=await Promise.all([payments.voidSettlement(f.shop,'settlement',body,owner,key),payments.voidSettlement(f.shop,'settlement',body,owner,key)]);assert.deepEqual(duplicate[0],duplicate[1]);assert.equal((await rows(f.shop,'pos_payment_voids')).length,1);assert.equal((await rows(f.shop,'pos_payments')).filter(row=>row.scope==='cod-settlement-void').length,1)
 const other=await fixture(1),raced=await Promise.allSettled([payments.voidSettlement(other.shop,'settlement',body,owner),payments.voidSettlement(other.shop,'settlement',body,owner)]);assert.equal(raced.filter(row=>row.status==='fulfilled').length,1);assert.equal(raced.find(row=>row.status==='rejected').reason.status,400)
 const fresh=await fixture(1),orderId=fresh.invoices[0].id,mixed=await Promise.allSettled([payments.voidSettlement(fresh.shop,'settlement',body,owner,randomUUID()),payments.receive(fresh.shop,orderId,{method:'Cash'},owner,randomUUID())]);assert.equal(mixed[0].status,'fulfilled');const value=await read(fresh.shop,'pos_orders',orderId),all=await rows(fresh.shop,'pos_payments');assert.equal(all.filter(row=>row.scope==='cod-settlement-void').length,1)
 if(mixed[1].status==='fulfilled'){assert.equal(value.paymentStatus,'paid');assert.equal(value.codCollectAmount,0);assert.equal(mixed[1].value.payment.amount,100)}else{assert.equal(mixed[1].reason.status,400);assert.equal(value.paymentStatus,'unpaid');assert.equal(value.codCollectAmount,100)}
 assert.deepEqual(await read(fresh.shop,'pos_payments','settlement'),fresh.settlement)
})
