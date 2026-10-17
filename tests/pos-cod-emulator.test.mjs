import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {createPosCodReceipts} from '../../BelleLocal POS app/functions/src/pos/cod-receipts.js'
import {createPosPayments} from '../../BelleLocal POS app/functions/src/pos/payments.js'
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('COD tests require isolated local Firebase emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url))
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
initializeApp({projectId:'demo-belle-online'})
const db=getFirestore(),auth=getAuth(),cod=createPosCodReceipts({db}),table=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`)
const date='2026-10-10T03:00:00.000Z',base='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
async function token(uid,email){try{await auth.createUser({uid,email,password:'Local-test-only-123!'})}catch(error){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(error.code))throw error}const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});return (await response.json()).idToken}
async function http(path,owner,body,key){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer '+owner}:{}),...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()}}
async function invoice(shop,key,extra={},membership=true){const order={id:key,shopId:shop,orderNumber:'COD-'+key,customerSnapshot:{name:'Saved COD buyer',phone:'099999'},subtotal:100,total:100,discount:0,deliveryFee:0,items:[{id:'item-'+key,productId:'fixture',quantity:1,baseQuantity:'1',lineTotal:100,allocations:[]}],saleType:'ONLINE',collectionArrangement:'COD',fulfillmentStatus:'completed',paymentStatus:'unpaid',paymentTracking:true,codCollectAmount:100,cancellationState:null,createdAt:date,...extra};await table(shop,'pos_orders').doc(key).set(order);if(membership)await table(shop,'pos_delivery_memberships').doc(key).set({id:key,orderId:key,handoverId:'handover-fixture'});return order}
const body=(values,extra={})=>({receivingMethod:'Cash',statementNumber:'123456',transactionId:'654321',paymentDate:'2026-10-11',amount:values.reduce((sum,entry)=>sum+entry.expectedBalance,0),allocations:values,...extra})
const select=(id,expectedBalance=100)=>({orderId:id,expectedBalance})
const rows=async(shop,name)=>(await table(shop,name).get()).docs.map((row)=>row.data())

test('COD HTTP enforces owner, canonical references/keys and Done eligibility; receipt/detail/void preserve original payments and ledger',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example')
  assert.equal((await http('payments/cod-pending')).status,401);assert.equal((await http('payments/cod-pending',other)).status,403)
  assert.equal((await http('payments/cod-settlements',owner,{})).data.code,'COD_RECEIPT_REQUIRED')
  const id='http-'+randomUUID(),number='COD-'+id;await invoice('belle-online',id)
  const scope=body([select(id)],{statementNumber:String(Date.now()).slice(-6),transactionId:String(Date.now()+1).slice(-6)}),key=randomUUID()
  assert.equal((await http('payments/cod-settlements/receive',owner,scope)).status,400)
  assert.equal((await http('payments/cod-settlements/receive',owner,{...scope,statementNumber:'12345'},key)).status,400)
  assert.equal((await http('payments/cod-settlements/receive',owner,{...scope,receivingMethod:'Disabled method'},key)).data.code,'PAYMENT_METHOD_CHANGED')
  assert.equal((await http('payments/cod-settlements/receive',other,scope,key)).status,403)
  const ledger={quantity:'7',source:'Immutable fixture'},legacy={amount:34500,paymentStatus:'unpaid'},legacyTables=['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta'];await table('belle-online','stock_balances').doc(id).set(ledger)
  for(const name of legacyTables)await db.doc('users/demo-owner/'+name+'/'+id).set(legacy)
  const pending=await http('payments/cod-pending?search='+number,owner);assert.equal(pending.data.invoices.length,1)
  const received=await http('payments/cod-settlements/receive',owner,scope,key);assert.equal(received.status,201,JSON.stringify(received.data));assert.equal(received.data.replayed,false)
  const settlement=received.data.settlement,allocation=settlement.allocations[0]
  const original=(await table('belle-online','pos_payments').doc(allocation.paymentId).get()).data()
  assert.equal(original.scope,'cod-receipt');assert.equal(original.paidAt,'2026-10-10T17:30:00.000Z');assert.equal(original.billNumber,scope.statementNumber)
  const replay=await http('payments/cod-settlements/receive',owner,scope,key);assert.equal(replay.status,200);assert.equal(replay.data.settlement.id,settlement.id)
  assert.equal((await http('payments/cod-settlements/receive',owner,{...scope,note:'changed'},key)).data.code,'IDEMPOTENCY_CONFLICT')
  assert.equal((await http('payments/cod-settlements/receive',owner,scope,randomUUID())).data.code,'DUPLICATE_COD_REFERENCE')
  const detail=await http('payments/cod-settlements/'+settlement.id,owner);assert.equal(detail.data.settlement.allocations[0].payment.amount,100);assert.equal(detail.data.settlement.allocations[0].order.orderNumber,number)
  const orderDetail=await http('orders/'+id,owner);assert.equal(orderDetail.data.codSettlements[0].allocations[0].order.orderNumber,number)
  assert.equal((await http('payments/cod-pending?search='+number,owner)).data.invoices.length,0)
  const reversed=await http('payments/cod-settlements/'+settlement.id+'/void',owner,{reason:'Wrong COD statement'},randomUUID());assert.equal(reversed.status,200);assert.equal(reversed.data.replayed,false)
  const later=(await http('payments/cod-settlements/'+settlement.id,owner)).data.settlement.allocations[0]
  assert.equal(later.correctionPayment.amount,-100);assert.equal(later.correctionPayment.originalPaymentId,allocation.paymentId)
  assert.deepEqual((await table('belle-online','pos_payments').doc(allocation.paymentId).get()).data(),original)
  assert.equal((await table('belle-online','pos_orders').doc(id).get()).data().paymentStatus,'unpaid')
  assert.equal((await http('payments/cod-pending?search='+number,owner)).data.invoices[0].remainingAmount,100)
  assert.deepEqual((await table('belle-online','stock_balances').doc(id).get()).data(),ledger)
  for(const name of legacyTables)assert.deepEqual((await db.doc('users/demo-owner/'+name+'/'+id).get()).data(),legacy)
})

test('COD current balances include discounted returns, direct and allocated receipts; sorting/search/page totals exclude ineligible invoices',async()=>{
  const shop='cod-list-'+randomUUID()
  await invoice(shop,'eligible',{customerSnapshot:{name:'Aye Buyer',phone:'ABC0999'}})
  await invoice(shop,'half-return',{subtotal:100,discount:10,total:90,createdAt:'2026-10-11T03:00:00.000Z'})
  await table(shop,'pos_customer_returns').doc('half-return').set({id:'half-return',orderId:'half-return',orderItemId:'item-half-return',quantity:'0.5',createdAt:date})
  await table(shop,'pos_payments').doc('direct').set({id:'direct',orderId:'half-return',amount:10,paidAt:date,createdAt:date})
  await table(shop,'pos_payments').doc('allocated').set({id:'allocated',orderId:null,amount:5,scope:'cod-settlement',orderIds:JSON.stringify(['half-return']),allocations:JSON.stringify([{orderId:'half-return',amount:5}])})
  await invoice(shop,'not-done',{fulfillmentStatus:'reserved'});await invoice(shop,'no-member',{},false);await invoice(shop,'cancel',{cancellationState:'RETURN_PENDING'});await invoice(shop,'in-store',{saleType:'IN_STORE'});await invoice(shop,'no-cod',{collectionArrangement:'NONE'})
  const first=await cod.pending(shop,{pageSize:1});assert.equal(first.pagination.total,2);assert.equal(first.pagination.hasMore,true);assert.equal(first.invoices[0].id,'half-return');assert.equal(first.invoices[0].total,45);assert.equal(first.invoices[0].remainingAmount,30)
  assert.equal((await cod.pending(shop,{search:'aye buyer'})).invoices[0].id,'eligible');assert.equal((await cod.pending(shop,{search:'abc0999'})).invoices.length,0,'Source phone search is case-sensitive.')
  const before=await rows(shop,'pos_payments')
  await assert.rejects(cod.receive(shop,body([select('half-return',31)]),'demo-owner',randomUUID()),{code:'COD_BALANCE_CHANGED',status:409})
  await assert.rejects(cod.receive(shop,body([select('not-done')]),'demo-owner',randomUUID()),{code:'COD_INELIGIBLE'})
  await assert.rejects(cod.receive(shop,body([select('cancel')]),'demo-owner',randomUUID()),{code:'ORDER_RETURN_PENDING'})
  await assert.rejects(cod.receive(shop,body([select('eligible'),select('missing')]),'demo-owner',randomUUID()),{status:404})
  await assert.rejects(cod.receive(shop,body([select('eligible')],{amount:99}),'demo-owner',randomUUID()),{code:'COD_BALANCE_CHANGED'})
  assert.deepEqual(await rows(shop,'pos_payments'),before);assert.equal((await rows(shop,'pos_cod_settlements')).length,0);assert.equal((await rows(shop,'pos_cod_references')).length,0)
  const result=await cod.receive(shop,body([select('eligible'),select('half-return',30)]),'demo-owner',randomUUID());assert.equal(result.settlement.amount,130)
})

test('COD concurrent key/reference and final-collection races serialize once; reversal replay and subsequent-change guards remain atomic',async()=>{
  const shop='cod-race-'+randomUUID(),payments=createPosPayments({db})
  await invoice(shop,'one');const input=body([select('one')]),key=randomUUID()
  const duplicates=await Promise.all([cod.receive(shop,input,'demo-owner',key),cod.receive(shop,input,'demo-owner',key)])
  assert.equal(duplicates[0].settlement.id,duplicates[1].settlement.id);assert.deepEqual(new Set(duplicates.map((row)=>row.replayed)),new Set([true,false]));assert.equal((await rows(shop,'pos_payments')).length,1)
  await invoice(shop,'two');await invoice(shop,'three')
  const references=await Promise.allSettled(['two','three'].map((orderId)=>cod.receive(shop,body([select(orderId)],{statementNumber:'333333'}),'demo-owner',randomUUID())))
  assert.equal(references.filter((row)=>row.status==='fulfilled').length,1);assert.equal(references.find((row)=>row.status==='rejected').reason.code,'DUPLICATE_COD_REFERENCE')
  await invoice(shop,'four');const mixed=await Promise.allSettled([cod.receive(shop,body([select('four')],{statementNumber:'444444'}),'demo-owner',randomUUID()),payments.receive(shop,'four',{method:'Cash',scope:'credit-settlement'},'demo-owner',randomUUID())])
  assert.equal(mixed.filter((row)=>row.status==='fulfilled').length,1);assert.equal((await table(shop,'pos_payments').where('orderId','==','four').get()).size,1)
  const settlementId=duplicates[0].settlement.id,reversalKey=randomUUID(),reasons={reason:'Correction'},reversals=await Promise.all([cod.reverse(shop,settlementId,reasons,'demo-owner',reversalKey),cod.reverse(shop,settlementId,reasons,'demo-owner',reversalKey)])
  assert.deepEqual(new Set(reversals.map((row)=>row.replayed)),new Set([true,false]));assert.equal((await table(shop,'pos_payments').where('orderId','==','one').get()).size,2)
  await assert.rejects(cod.reverse(shop,settlementId,{reason:'Different'},'demo-owner',reversalKey),{code:'SETTLEMENT_CHANGED'})
  const replay=await cod.receive(shop,input,'demo-owner',key);assert.ok(replay.settlement.reversedAt);assert.equal(replay.replayed,true)
  await invoice(shop,'changed');const created=await cod.receive(shop,body([select('changed')],{statementNumber:'555555'}),'demo-owner',randomUUID())
  await table(shop,'pos_customer_returns').doc('later-return').set({id:'later-return',orderId:'changed',orderItemId:'item-changed',quantity:'0.5',createdAt:new Date(Date.now()+1000).toISOString()})
  await assert.rejects(cod.reverse(shop,created.settlement.id,reasons,'demo-owner',randomUUID()),{code:'SETTLEMENT_CHANGED'})
  assert.equal((await table(shop,'pos_payments').where('orderId','==','changed').get()).size,1)
})

test('COD source maximum of 500 allocations receives and reverses atomically without rewriting original receipts',async()=>{
  const shop='cod-500-'+randomUUID(),batch=db.batch(),entries=[]
  for(let i=0;i<500;i++){const key='bulk-'+String(i).padStart(3,'0'),order={id:key,shopId:shop,orderNumber:'BULK-'+i,subtotal:1,total:1,discount:0,items:[{id:'item-'+key,quantity:1,baseQuantity:'1',lineTotal:1}],saleType:'ONLINE',collectionArrangement:'COD',fulfillmentStatus:'completed',cancellationState:null,createdAt:date};batch.set(table(shop,'pos_orders').doc(key),order);batch.set(table(shop,'pos_delivery_memberships').doc(key),{orderId:key,handoverId:'bulk-fixture'});entries.push(select(key,1))}
  await batch.commit()
  const key=randomUUID(),result=await cod.receive(shop,body(entries),'demo-owner',key)
  assert.equal(result.settlement.allocations.length,500);assert.equal((await rows(shop,'pos_payments')).length,500);assert.equal((await rows(shop,'pos_cod_settlement_allocations')).length,500);assert.equal((await rows(shop,'pos_audit')).length,500)
  const reversed=await cod.reverse(shop,result.settlement.id,{reason:'Bulk correction'},'demo-owner',randomUUID());assert.equal(reversed.replayed,false)
  const records=await rows(shop,'pos_payments');assert.equal(records.length,1000);assert.equal(records.filter((payment)=>payment.amount===1).length,500);assert.equal(records.filter((payment)=>payment.amount===-1).length,500)
  assert.ok((await rows(shop,'pos_orders')).every((order)=>order.paymentStatus==='unpaid'&&order.codCollectAmount===1))
})

test('COD reversal refuses later collections, already-refunded originals, pending cancellation, changed state and missing invoices with no partial correction',async()=>{
  for(const condition of ['later-payment','original-refund','cancellation','not-completed','missing']){
    const shop='cod-guard-'+randomUUID();await invoice(shop,'target')
    const result=await cod.receive(shop,body([select('target')]),'demo-owner',randomUUID()),allocation=result.settlement.allocations[0]
    if(condition==='later-payment')await table(shop,'pos_payments').doc('later').set({id:'later',orderId:'target',type:'payment',amount:1,createdAt:new Date(Date.now()+1000).toISOString()})
    if(condition==='original-refund')await table(shop,'pos_payments').doc('refund').set({id:'refund',orderId:'target',type:'refund',amount:-1,originalPaymentId:allocation.paymentId,createdAt:date})
    if(condition==='cancellation')await table(shop,'pos_orders').doc('target').update({cancellationState:'RETURN_PENDING'})
    if(condition==='not-completed')await table(shop,'pos_orders').doc('target').update({fulfillmentStatus:'reserved'})
    if(condition==='missing')await table(shop,'pos_orders').doc('target').delete()
    const before=await rows(shop,'pos_payments'),allocations=await rows(shop,'pos_cod_settlement_allocations')
    await assert.rejects(cod.reverse(shop,result.settlement.id,{reason:'Guard case'},'demo-owner',randomUUID()),{code:'SETTLEMENT_CHANGED'})
    assert.deepEqual(await rows(shop,'pos_payments'),before);assert.deepEqual(await rows(shop,'pos_cod_settlement_allocations'),allocations)
    assert.equal((await table(shop,'pos_cod_settlements').doc(result.settlement.id).get()).data().reversedAt,null)
  }
})
