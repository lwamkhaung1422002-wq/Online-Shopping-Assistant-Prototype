import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {createPosContacts} from '../../BelleLocal POS app/functions/src/pos/contacts.js'
import {createPosSupplierPayments} from '../../BelleLocal POS app/functions/src/pos/supplier-payments.js'
import {createPosSettings} from '../../BelleLocal POS app/functions/src/pos/settings.js'
import {createPosPaymentHistory} from '../../BelleLocal POS app/functions/src/pos/payment-history.js'
import {signatureFixture} from './handover-signature-fixture.mjs'
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Supplier payment tests require isolated local Firebase emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url))
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
initializeApp({projectId:'demo-belle-online'});const db=getFirestore(),auth=getAuth()
const contacts=createPosContacts({db,getCreatorName:async()=>'Demo Belle Owner'}),payments=createPosSupplierPayments({db}),settings=createPosSettings({db}),history=createPosPaymentHistory({db})
const table=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`),base='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
const body=(invoice,amount=50000)=>({name:'Supplier '+randomUUID().slice(0,8),phone:'0999999',deliveryRecord:{invoiceNumber:invoice,deliveryName:'Supplier truck',deliveryPhone:'0912345',receivedAt:'2026-10-01',dueAt:'2026-10-20',amount}})
const cash=(amount,extra={})=>({amount,method:'Cash',payerName:'Saved receiver',payerPhone:'09912345',signatureDataUrl:signatureFixture(),...extra})
async function fixture(amount=50000){const shop='supplier-payment-'+randomUUID(),input=body('SUP-'+randomUUID(),amount),{record}=await contacts.saveDelivery(shop,null,input,'demo-owner');return {shop,input,record}}
async function snapshot(shop){const value={};for(const name of ['pos_supplier_delivery_records','pos_supplier_delivery_payments','pos_supplier_delivery_payment_reversals','pos_supplier_delivery_locks','pos_supplier_locks','pos_requests','pos_audit','pos_purchases','pos_purchase_payments','pos_expenses','pos_orders','pos_payments','pos_stock_balances','pos_stock_batches','pos_stock_movements'])value[name]=(await table(shop,name).get()).docs.map((row)=>[row.id,row.data()]);return value}
async function token(uid,email){try{await auth.createUser({uid,email,password:'Local-test-only-123!'})}catch(error){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(error.code))throw error}const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});assert.equal(response.status,200);return (await response.json()).idToken}
async function http(path,owner,body,key,method=body===undefined?'GET':'POST'){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer '+owner}:{}),...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()}}

test('Supplier invoice payment/reversal HTTP uses owner access, original cash/mobile fields, saved-response replay and immutable receipt history',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example');await auth.updateUser('demo-owner',{displayName:'Demo Belle Owner'})
  const input=body('SUP-HTTP-'+randomUUID()),created=await http('suppliers',owner,input);assert.equal(created.status,201);const record=created.data.record,path='supplier-delivery-records/'+record.id+'/payments'
  assert.equal((await http(path,undefined,cash(1000),randomUUID())).status,401)
  assert.equal((await http(path,other,cash(1000),randomUUID())).status,403)
  for(const payment of [{amount:1000,method:'Cash'},{amount:1000,method:'KPay'},{amount:0,method:'Cash',signatureDataUrl:signatureFixture()},cash(50001),cash(1.5)])assert.equal((await http(path,owner,payment,randomUUID())).status,400)
  assert.equal((await http(path,owner,{amount:1000,method:'Missing Bank',reference:'12345'},randomUUID())).status,409)
  const key=randomUUID(),inputPayment=cash(20000,{paidAt:'2026-10-02T04:00:00Z',notes:'Original supplier receipt',actorId:'forged-owner'})
  const first=await http(path,owner,inputPayment,key);assert.equal(first.status,201);const original=first.data.payment
  assert.equal(original.amount,20000);assert.equal(original.paidAt,'2026-10-02T04:00:00.000Z');assert.equal(original.payerName,'Saved receiver');assert.equal(original.signatureDataUrl,signatureFixture());assert.equal(original.actorId,undefined)
  assert.deepEqual((await http(path,owner,inputPayment,key)).data,first.data)
  assert.equal((await http(path,owner,{...inputPayment,amount:19000},key)).status,409)
  const detail=(await http('supplier-delivery-records/'+record.id,owner)).data.record
  assert.equal(detail.remaining,30000);assert.equal(detail.activePaid,20000);assert.equal(detail.allowedActions.cancelPayment,true)
  assert.equal((await http('supplier-delivery-records/'+record.id+'/cancel',owner,{reason:'Cannot cancel active payment'})).status,400)
  const reversePath=path+'/'+original.id+'/reverse'
  assert.equal((await http(reversePath,other,{reason:'Foreign actor'})).status,403)
  assert.equal((await http(reversePath,owner,{reason:' '})).status,400)
  const reversed=await http(reversePath,owner,{reason:' Duplicate payment ',actorId:'forged-owner'})
  assert.equal(reversed.status,200);assert.equal(reversed.data.reversal.actorId,'demo-owner');assert.equal(reversed.data.reversal.reason,'Duplicate payment');assert.equal(reversed.data.record.remaining,50000)
  assert.equal((await http(reversePath,owner,{reason:'Second reversal'})).status,400)
  assert.deepEqual((await table('belle-online','pos_supplier_delivery_payments').doc(original.id).get()).data(),original)
  assert.deepEqual((await http(path,owner,inputPayment,key)).data,first.data)
  // Source history applies search only in paged mode. Without this flag a
  // populated emulator returns every supplier receipt, not just this invoice.
  const historyRows=(await http('payment-history?view=history&paged=true&search='+encodeURIComponent(record.invoiceNumber),owner)).data.records
  assert.equal(historyRows.filter((row)=>row.kind==='supplier-payment').length,1);assert.equal(historyRows.filter((row)=>row.kind==='supplier-payment-cancelled').length,1)
  assert.ok(historyRows.every(row=>row.apiId===record.id&&row.paymentId===original.id))
  const cancelled=await http('supplier-delivery-records/'+record.id+'/cancel',owner,{reason:'Kept cancelled invoice'});assert.equal(cancelled.status,200)
  assert.equal((await http(path,owner,cash(1000),randomUUID())).status,400)
})

test('Supplier receiving methods, source duplicate references and dates preserve settings and legacy data without stock/order side effects',async()=>{
  const {shop,record}=await fixture()
  await settings.save(shop,{paymentMethods:[{id:'kpay',name:'KPay',type:'normal',active:true},{id:'disabled',name:'Disabled Bank',type:'normal',active:false}]})
  const legacyTables=['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta'],legacyId='supplier-legacy-'+randomUUID(),original={id:legacyId,amount:34500,status:'unpaid',note:'Original immutable Belle record'}
  for(const name of legacyTables)await db.doc(`users/demo-owner/${name}/${legacyId}`).set(original)
  const before=await snapshot(shop)
  for(const method of ['COD','Disabled Bank','Missing Bank'])await assert.rejects(payments.receive(shop,record.id,{amount:1000,method,reference:'blocked'},'demo-owner',randomUUID()),{status:409})
  await assert.rejects(payments.receive(shop,record.id,cash(1000,{notes:'x'.repeat(850001)}),'demo-owner',randomUUID()),{status:409})
  assert.deepEqual(await snapshot(shop),before)
  const input={amount:10000,method:'KPay',reference:'SUP-TRX',payerName:'Mobile receiver',payerPhone:'09999',mobileAccountName:'Saved KPay name',notes:'Due date: 2026-10-20',paidAt:'2026-10-03T03:00:00Z'}
  const first=await payments.receive(shop,record.id,input,'demo-owner',randomUUID()),second=await payments.receive(shop,record.id,input,'demo-owner',randomUUID())
  assert.notEqual(first.payment.id,second.payment.id) // The reference has no supplier-reference uniqueness constraint.
  assert.equal(first.payment.signatureDataUrl,null);assert.equal(first.payment.mobileAccountName,'Saved KPay name');assert.equal(first.payment.reference,'SUP-TRX')
  assert.equal((await contacts.deliveryRecord(shop,record.id)).record.remaining,30000)
  const after=await snapshot(shop)
  assert.deepEqual(after.pos_supplier_delivery_records,before.pos_supplier_delivery_records)
  for(const name of ['pos_purchases','pos_purchase_payments','pos_expenses','pos_orders','pos_payments','pos_stock_balances','pos_stock_batches','pos_stock_movements'])assert.deepEqual(after[name],before[name])
  for(const name of legacyTables)assert.deepEqual((await db.doc(`users/demo-owner/${name}/${legacyId}`).get()).data(),original)
})

test('Concurrent supplier final payments, same-key receipts and reversals serialize the outstanding balance and retain original financial evidence',async()=>{
  const {shop,record}=await fixture()
  const competing=await Promise.allSettled([1,2].map(()=>payments.receive(shop,record.id,cash(40000),'demo-owner',randomUUID())))
  assert.equal(competing.filter((row)=>row.status==='fulfilled').length,1);assert.equal(competing.find((row)=>row.status==='rejected').reason.status,400)
  const original=competing.find((row)=>row.status==='fulfilled').value.payment
  const key=randomUUID(),received=await Promise.all(Array.from({length:5},()=>payments.receive(shop,record.id,cash(10000),'demo-owner',key)))
  assert.equal(new Set(received.map((row)=>row.payment.id)).size,1);assert.equal((await contacts.deliveryRecord(shop,record.id)).record.invoiceStatus,'Paid')
  const reversal=await Promise.allSettled(Array.from({length:5},()=>payments.reverse(shop,record.id,original.id,{reason:'One immutable correction'},'demo-owner')))
  assert.equal(reversal.filter((row)=>row.status==='fulfilled').length,1);for(const row of reversal.filter((row)=>row.status==='rejected'))assert.equal(row.reason.status,400)
  assert.equal((await contacts.deliveryRecord(shop,record.id)).record.remaining,40000)
  assert.deepEqual((await table(shop,'pos_supplier_delivery_payments').doc(original.id).get()).data(),original)
  const events=(await table(shop,'pos_supplier_delivery_payment_reversals').get()).docs;assert.equal(events.length,1);assert.equal(events[0].data().originalPaymentId,original.id)
  const audit=(await table(shop,'pos_audit').get()).docs.map((row)=>row.data()).filter((row)=>row.action==='supplier.delivery.payment.reverse');assert.equal(audit.length,1);assert.equal(audit[0].metadata.amount,40000)
})

test('Pay versus cancellation/edit and reversal versus recollection use the same invoice lock and never commit an inconsistent financial state',async()=>{
  for(let round=0;round<2;round++){
    const {shop,record}=await fixture()
    const race=await Promise.allSettled([payments.receive(shop,record.id,cash(50000),'demo-owner',randomUUID()),contacts.cancelDelivery(shop,record.id,{reason:'Competing cancellation'},'demo-owner')])
    assert.equal(race.filter((row)=>row.status==='fulfilled').length,1);assert.equal(race.find((row)=>row.status==='rejected').reason.status,400)
    const saved=(await contacts.deliveryRecord(shop,record.id)).record
    if(saved.status==='cancelled'){assert.equal(saved.payments.length,0);assert.equal(saved.activePaid,0)}else{assert.equal(saved.payments.length,1);assert.equal(saved.invoiceStatus,'Paid')}
  }
  const {shop,record,input}=await fixture()
  const race=await Promise.allSettled([payments.receive(shop,record.id,cash(40000),'demo-owner',randomUUID()),contacts.saveDelivery(shop,record.id,{...input,deliveryRecord:{...input.deliveryRecord,amount:30000}},'demo-owner')])
  assert.equal(race.filter((row)=>row.status==='fulfilled').length,1)
  const saved=(await contacts.deliveryRecord(shop,record.id)).record;assert.ok(saved.activePaid<=saved.amount)
  const other=await fixture(20000),initial=(await payments.receive(other.shop,other.record.id,cash(20000),'demo-owner',randomUUID())).payment
  const release=await Promise.allSettled([payments.reverse(other.shop,other.record.id,initial.id,{reason:'Release payable'},'demo-owner'),payments.receive(other.shop,other.record.id,cash(20000),'demo-owner',randomUUID())])
  assert.equal(release[0].status,'fulfilled')
  if(release[1].status==='rejected')assert.equal(release[1].reason.status,400)
  assert.ok((await contacts.deliveryRecord(other.shop,other.record.id)).record.activePaid<=20000)
  assert.deepEqual((await table(other.shop,'pos_supplier_delivery_payments').doc(initial.id).get()).data(),initial)
})

test('Foreign/missing receipts, old reversedAt markers and inactive invoices fail without partial requests, audit, lock or balance updates',async()=>{
  const first=await fixture(),other=await fixture(),payment=(await payments.receive(first.shop,first.record.id,cash(10000),'demo-owner',randomUUID())).payment
  const before=await snapshot(other.shop)
  await assert.rejects(payments.reverse(other.shop,other.record.id,payment.id,{reason:'Foreign payment'},'demo-owner'),{status:404})
  await assert.rejects(payments.receive(other.shop,randomUUID(),cash(1000),'demo-owner',randomUUID()),{status:404})
  await assert.rejects(payments.reverse(other.shop,other.record.id,randomUUID(),{reason:'Missing payment'},'demo-owner'),{status:404})
  assert.deepEqual(await snapshot(other.shop),before)
  await table(first.shop,'pos_supplier_delivery_payments').doc(payment.id).update({reversedAt:'2026-10-04T00:00:00Z',reversalReason:'Historical new-namespace fixture marker'})
  const marked=await snapshot(first.shop)
  await assert.rejects(payments.reverse(first.shop,first.record.id,payment.id,{reason:'Do not reverse twice'},'demo-owner'),{status:400})
  assert.deepEqual(await snapshot(first.shop),marked)
  await contacts.cancelDelivery(first.shop,first.record.id,{reason:'No active receipt'},'demo-owner')
  const cancelled=await snapshot(first.shop)
  await assert.rejects(payments.receive(first.shop,first.record.id,cash(1000),'demo-owner',randomUUID()),{status:400})
  await assert.rejects(payments.reverse(first.shop,first.record.id,payment.id,{reason:'Inactive invoice'},'demo-owner'),{status:400})
  assert.deepEqual(await snapshot(first.shop),cancelled)
  const projected=await history.read(first.shop,{view:'worklist',search:first.record.invoiceNumber});assert.equal(projected.records[0].status,'Cancelled');assert.equal(projected.records[0].allowedActions.pay,false)
})
