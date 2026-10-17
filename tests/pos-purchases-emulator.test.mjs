import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {createPosPurchases} from '../../BelleLocal POS app/functions/src/pos/purchases.js'
import {createPosCatalog} from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import {createPosContacts} from '../../BelleLocal POS app/functions/src/pos/contacts.js'
import {signatureFixture} from './handover-signature-fixture.mjs'
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Purchase tests require isolated local Firebase emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url))
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
initializeApp({projectId:'demo-belle-online'});const db=getFirestore(),auth=getAuth(),purchases=createPosPurchases({db}),catalog=createPosCatalog({db})
const contacts=createPosContacts({db}),cash=(amount,extra={})=>({amount,method:'Cash',signatureDataUrl:signatureFixture(),...extra})
const table=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`)
// The reference POST Suppliers creates an unlinked invoice, not a supplier.
// Existing linked supplier identities are an explicit isolated input fixture.
async function fixture(shop='purchase-'+randomUUID()){
  const supplier={id:randomUUID(),shopId:shop,name:'Purchase supplier '+randomUUID(),isActive:true,phone:'0999999',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z'}
  await table(shop,'pos_suppliers').doc(supplier.id).set(supplier)
  const product=await catalog.create(shop,{name:'Purchase product '+randomUUID(),cost:100,price:200,units:[{name:'Piece',conversionFactor:1,isBase:true}]},'demo-owner',randomUUID())
  return {shop,supplier,product,input:{supplierId:supplier.id,items:[{productId:product.id,quantity:2.5,unitCost:101}],deliveryCost:50}}
}
async function token(uid,email){try{await auth.createUser({uid,email,password:'Local-test-only-123!'})}catch(error){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(error.code))throw error}const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});assert.equal(response.status,200);return (await response.json()).idToken}
const base='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
async function http(path,owner,body,key){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer '+owner}:{}),...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()}}
async function snapshot(shop){const result={};for(const name of ['pos_purchases','pos_product_suppliers','pos_sequences','pos_audit','pos_requests','pos_catalog_locks','stock_batches','stock_balances','stock_movements','stock_reservations','pos_purchase_receipts','pos_purchase_payments','pos_purchase_payment_reversals'])result[name]=(await table(shop,name).get()).docs.map(row=>[row.id,row.data()]);return result}

test('Purchase payment HTTP retains signed receipt, source audit and saved response after an immutable owner-only reversal',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example'),f=await fixture('belle-online')
  const purchase=(await purchases.create(f.shop,f.input,'demo-owner',randomUUID())).purchase,path='purchases/'+purchase.id+'/payments',key=randomUUID(),input=cash(100,{payerName:'Original receiver',payerPhone:'099123',paidAt:'2026-10-02',notes:'Original receipt',actorId:'forged'})
  assert.equal((await http(path,undefined,input,key)).status,401);assert.equal((await http(path,other,input,key)).status,403)
  const first=await http(path,owner,input,key);assert.equal(first.status,201);assert.equal(first.data.purchase.paidAmount,100);assert.equal(first.data.purchase.paymentStatus,'partial')
  const original=first.data.purchase.payments[0];assert.equal(original.paidAt,'2026-10-02T00:00:00.000Z');assert.equal(original.payerName,'Original receiver');assert.equal(original.payerPhone,'099123');assert.equal(original.signatureDataUrl,signatureFixture());assert.equal(original.actorId,undefined)
  assert.deepEqual((await http(path,owner,input,key)).data,first.data);assert.equal((await http(path,owner,{...input,amount:101},key)).status,409)
  const reversePath=path+'/'+original.id+'/reverse'
  assert.equal((await http(reversePath,other,{reason:'Foreign actor'})).status,403);assert.equal((await http(reversePath,owner,{reason:' '})).status,400)
  const reversed=await http(reversePath,owner,{reason:' Duplicate payment ',actorId:'forged',actorRole:'MANAGER'});assert.equal(reversed.status,201);assert.equal(reversed.data.purchase.paidAmount,0);assert.equal(reversed.data.purchase.paymentStatus,'unpaid')
  const corrected=reversed.data.purchase.payments[0];assert.equal(corrected.reversalReason,'Duplicate payment');assert.ok(corrected.reversedAt);assert.deepEqual({...corrected,reversedAt:null,reversalReason:null},original)
  assert.deepEqual((await table(f.shop,'pos_purchase_payments').doc(original.id).get()).data(),original)
  assert.deepEqual((await http(path,owner,input,key)).data,first.data);assert.equal((await http(reversePath,owner,{reason:'Second reversal'})).status,400)
  const events=(await table(f.shop,'pos_purchase_payment_reversals').where('purchaseId','==',purchase.id).get()).docs;assert.equal(events.length,1);assert.equal(events[0].data().actorId,'demo-owner')
  const audit=(await table(f.shop,'pos_audit').where('entityId','==',purchase.id).get()).docs.map(row=>row.data())
  assert.equal(audit.filter(row=>row.action==='purchase.payment').length,1)
  assert.deepEqual(audit.find(row=>row.action==='purchase.payment').metadata,{amount:100,method:'Cash',notes:'Original receipt',paidAt:'2026-10-02T00:00:00.000Z'})
  assert.deepEqual(audit.find(row=>row.action==='purchase.payment.reverse').metadata,{paymentId:original.id,amount:100,reason:'Duplicate payment',actorRole:'OWNER',authorizationMode:'direct'})
  const listed=(await http('purchases?search='+purchase.purchaseNumber,owner)).data.purchases[0];assert.deepEqual(listed,reversed.data.purchase)
  const invoices=(await http('supplier-delivery-invoices?search='+purchase.purchaseNumber,owner)).data;assert.equal(invoices.records.length,1);assert.equal(invoices.records[0].status,'Credit');assert.equal(invoices.records[0].amount,303);assert.deepEqual(invoices.records[0].purchase.payments,[corrected])
  const suppliers=(await contacts.suppliers(f.shop,{search:f.supplier.name})).suppliers;assert.ok(suppliers[0].purchases.some(row=>row.total===303&&row.paidAmount===0))
})

test('Purchase validation rolls back receipts, audit and requests while mobile fields and duplicate transaction references retain source semantics',async()=>{
  const f=await fixture(),purchase=(await purchases.create(f.shop,f.input,'demo-owner',randomUUID())).purchase
  await table(f.shop,'pos_settings').doc('main').set({paymentMethods:[{id:'kpay',name:'KPay',active:true,type:'normal'},{id:'disabled',name:'Disabled',active:false,type:'normal'}]})
  const before=await snapshot(f.shop)
  for(const input of [{amount:1,method:'Cash'},{amount:1,method:'KPay'},cash(0),cash(1.5),cash(304),cash(2147483648),cash(1,{paidAt:'not-a-date'})])await assert.rejects(purchases.pay(f.shop,purchase.id,input,'demo-owner',randomUUID()),{status:400})
  for(const method of ['COD','Disabled','Missing'])await assert.rejects(purchases.pay(f.shop,purchase.id,{amount:1,method,reference:'blocked'},'demo-owner',randomUUID()),{status:409})
  await assert.rejects(purchases.pay(f.shop,purchase.id,cash(1,{notes:'x'.repeat(850001)}),'demo-owner',randomUUID()),{status:409});assert.deepEqual(await snapshot(f.shop),before)
  const legacyId='purchase-payment-legacy-'+randomUUID(),names=['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta'],legacy={amount:34500,status:'reserved',paymentStatus:'unpaid'}
  for(const name of names)await db.doc(`users/demo-owner/${name}/${legacyId}`).set(legacy)
  const input={amount:100,method:'KPay',reference:'Repeated reference',mobileAccountName:'Saved mobile name',payerName:'Saved receiver',payerPhone:'099999',notes:'Due date: 2026-10-20',paidAt:'2026-10-03'}
  await purchases.pay(f.shop,purchase.id,input,'demo-owner',randomUUID());const second=await purchases.pay(f.shop,purchase.id,input,'demo-owner',randomUUID())
  assert.equal(second.purchase.paidAmount,200);assert.equal(second.purchase.payments.length,2);assert.notEqual(second.purchase.payments[0].id,second.purchase.payments[1].id)
  for(const row of second.purchase.payments){assert.equal(row.signatureDataUrl,null);assert.equal(row.mobileAccountName,input.mobileAccountName);assert.equal(row.payerName,input.payerName);assert.equal(row.reference,input.reference);assert.equal(row.paidAt,'2026-10-03T00:00:00.000Z')}
  const paid=await purchases.pay(f.shop,purchase.id,cash(103),'demo-owner',randomUUID());assert.equal(paid.purchase.paidAmount,303);assert.equal(paid.purchase.paymentStatus,'paid')
  const after=await snapshot(f.shop);for(const name of ['stock_batches','stock_balances','stock_movements','stock_reservations','pos_purchase_receipts','pos_sequences','pos_catalog_locks','pos_product_suppliers'])assert.deepEqual(after[name],before[name])
  for(const name of names)assert.deepEqual((await db.doc(`users/demo-owner/${name}/${legacyId}`).get()).data(),legacy)
})

test('Purchase cancellation retains reason and descriptive approver, paid/received guards and the reference repeat-cancel behavior',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example'),f=await fixture('belle-online'),purchase=(await purchases.create(f.shop,f.input,'demo-owner',randomUUID())).purchase,path='purchases/'+purchase.id+'/cancel'
  assert.equal((await http(path,other,{reason:'Foreign',approver:'Anyone'})).status,403)
  for(const input of [{reason:'x'},{approver:'x'},{reason:' ',approver:'x'}])assert.equal((await http(path,owner,input)).status,400)
  await purchases.pay(f.shop,purchase.id,cash(100),'demo-owner',randomUUID());assert.equal((await http(path,owner,{reason:'Paid invoice',approver:'Owner'})).status,400)
  const receipt=(await purchases.list(f.shop,{search:purchase.purchaseNumber})).purchases[0].payments[0];await purchases.reversePayment(f.shop,purchase.id,receipt.id,{reason:'Unpay before cancel'},'demo-owner')
  const cancelled=await http(path,owner,{reason:' Keep invoice ',approver:' Descriptive approver ',actorId:'forged'});assert.equal(cancelled.status,200);assert.equal(cancelled.data.purchase.status,'cancelled');assert.equal(cancelled.data.purchase.cancelReason,'Keep invoice');assert.equal(cancelled.data.purchase.cancelApprovedBy,'Descriptive approver')
  assert.equal(cancelled.data.purchase.payments.length,1);assert.ok(cancelled.data.purchase.payments[0].reversedAt)
  assert.equal((await http('purchases/'+purchase.id+'/payments',owner,cash(1),randomUUID())).status,400)
  const repeated=await http(path,owner,{reason:'Updated cancellation reason',approver:'Owner'});assert.equal(repeated.status,200);assert.equal(repeated.data.purchase.cancelReason,'Updated cancellation reason')
  const audits=(await table(f.shop,'pos_audit').where('entityId','==',purchase.id).get()).docs.map(row=>row.data()).filter(row=>row.action==='purchase.cancel');assert.equal(audits.length,2);assert.ok(audits.every(row=>row.actorId==='demo-owner'))
  const invoices=(await contacts.deliveryInvoices(f.shop,{search:purchase.purchaseNumber})).records;assert.equal(invoices[0].status,'Cancel');assert.equal(invoices[0].amount,0)
  for(const status of ['received','partially_received']){
    // Receipt writer remains pending. These explicit input states test only its
    // source lifecycle guard; they do not claim inventory receiving evidence.
    await table(f.shop,'pos_purchases').doc(purchase.id).update({status});const before=await snapshot(f.shop)
    await assert.rejects(purchases.cancel(f.shop,purchase.id,{reason:'Cannot cancel receipt',approver:'Owner'},'demo-owner'),{status:400});assert.deepEqual(await snapshot(f.shop),before)
  }
})

test('Purchase final-payment contention, keyed retries and exactly-once reversal preserve the financial aggregate and original receipts',async()=>{
  const f=await fixture(),purchase=(await purchases.create(f.shop,f.input,'demo-owner',randomUUID())).purchase
  const final=await Promise.allSettled(Array.from({length:2},()=>purchases.pay(f.shop,purchase.id,cash(200),'demo-owner',randomUUID())))
  assert.equal(final.filter(row=>row.status==='fulfilled').length,1);assert.equal(final.find(row=>row.status==='rejected').reason.status,400)
  const original=final.find(row=>row.status==='fulfilled').value.purchase.payments[0],key=randomUUID()
  const retries=await Promise.all(Array.from({length:4},()=>purchases.pay(f.shop,purchase.id,cash(103),'demo-owner',key)));for(const retry of retries)assert.deepEqual(retry,retries[0]);assert.equal(retries[0].purchase.paidAmount,303);assert.equal(retries[0].purchase.payments.length,2)
  const reversed=await Promise.allSettled(Array.from({length:4},()=>purchases.reversePayment(f.shop,purchase.id,original.id,{reason:'One correction'},'demo-owner')))
  assert.equal(reversed.filter(row=>row.status==='fulfilled').length,1);for(const row of reversed.filter(row=>row.status==='rejected'))assert.equal(row.reason.status,400)
  assert.deepEqual((await table(f.shop,'pos_purchase_payments').doc(original.id).get()).data(),original)
  const updated=(await purchases.list(f.shop,{})).purchases[0];assert.equal(updated.paidAmount,103);assert.equal(updated.paymentStatus,'partial');assert.equal(updated.payments.filter(row=>row.reversedAt).length,1)
  const correctionCount=(await table(f.shop,'pos_purchase_payment_reversals').get()).size;assert.equal(correctionCount,1)
  const recollect=await purchases.pay(f.shop,purchase.id,cash(200),'demo-owner',randomUUID());assert.equal(recollect.purchase.paymentStatus,'paid');assert.equal(recollect.purchase.payments.length,3)
})

test('Payment versus cancel and reversal versus recollection serialize on the purchase parent without financial or lifecycle contradictions',async()=>{
  for(let round=0;round<3;round++){
    const f=await fixture(),purchase=(await purchases.create(f.shop,f.input,'demo-owner',randomUUID())).purchase
    const race=await Promise.allSettled([purchases.pay(f.shop,purchase.id,cash(100),'demo-owner',randomUUID()),purchases.cancel(f.shop,purchase.id,{reason:'Race',approver:'Owner'},'demo-owner')])
    assert.equal(race.filter(row=>row.status==='fulfilled').length,1);assert.equal(race.find(row=>row.status==='rejected').reason.status,400)
    const saved=(await purchases.list(f.shop,{})).purchases[0];assert.ok((saved.status==='cancelled'&&saved.paidAmount===0&&saved.payments.length===0)||(saved.status==='draft'&&saved.paidAmount===100&&saved.payments.length===1))
  }
  const f=await fixture(),purchase=(await purchases.create(f.shop,f.input,'demo-owner',randomUUID())).purchase,paid=await purchases.pay(f.shop,purchase.id,cash(200),'demo-owner',randomUUID()),original=paid.purchase.payments[0]
  const race=await Promise.allSettled([purchases.reversePayment(f.shop,purchase.id,original.id,{reason:'Race correction'},'demo-owner'),purchases.pay(f.shop,purchase.id,cash(200),'demo-owner',randomUUID())])
  assert.equal(race[0].status,'fulfilled');if(race[1].status==='rejected')assert.equal(race[1].reason.status,400)
  const saved=(await purchases.list(f.shop,{})).purchases[0];assert.equal(saved.paidAmount,race[1].status==='fulfilled'?200:0);assert.equal(saved.payments.filter(row=>!row.reversedAt).reduce((sum,row)=>sum+row.amount,0),saved.paidAmount)
  assert.deepEqual((await table(f.shop,'pos_purchase_payments').doc(original.id).get()).data(),original)
})

test('Missing/foreign/reversed receipts and oversized reversal preserve source scope and roll back every write',async()=>{
  const f=await fixture(),purchase=(await purchases.create(f.shop,f.input,'demo-owner',randomUUID())).purchase,paid=await purchases.pay(f.shop,purchase.id,cash(100),'demo-owner',randomUUID()),payment=paid.purchase.payments[0]
  const second=(await purchases.create(f.shop,f.input,'demo-owner',randomUUID())).purchase,before=await snapshot(f.shop)
  await assert.rejects(purchases.pay(f.shop,randomUUID(),cash(1),'demo-owner',randomUUID()),{status:404})
  await assert.rejects(purchases.cancel(f.shop,randomUUID(),{reason:'Missing',approver:'Owner'},'demo-owner'),{status:404})
  await assert.rejects(purchases.reversePayment(f.shop,randomUUID(),payment.id,{reason:'Missing'},'demo-owner'),{status:404})
  await assert.rejects(purchases.reversePayment(f.shop,second.id,payment.id,{reason:'Foreign'},'demo-owner'),{status:404})
  await assert.rejects(purchases.reversePayment(f.shop,purchase.id,randomUUID(),{reason:'Missing'},'demo-owner'),{status:404})
  await assert.rejects(purchases.reversePayment(f.shop,purchase.id,payment.id,{reason:'x'.repeat(850001)},'demo-owner'),{status:409});assert.deepEqual(await snapshot(f.shop),before)
  await table(f.shop,'pos_purchase_payments').doc(payment.id).update({reversedAt:'2026-10-04',reversalReason:'Old marker'});const old=await snapshot(f.shop)
  await assert.rejects(purchases.reversePayment(f.shop,purchase.id,payment.id,{reason:'Already reversed'},'demo-owner'),{status:400});assert.deepEqual(await snapshot(f.shop),old)
})

test('Purchase HTTP creates and sends a real draft with source unit/money snapshots, owner checks and durable retry without changing stock or legacy records',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example'),f=await fixture('belle-online')
  assert.equal((await http('purchases')).status,401);assert.equal((await http('purchases',other,f.input)).status,403)
  const legacyId='purchase-legacy-'+randomUUID(),original={total:34500,status:'reserved',paymentStatus:'unpaid',name:'Original Belle'}
  const names=['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta']
  for(const name of names)await db.doc(`users/demo-owner/${name}/${legacyId}`).set(original)
  const before=await snapshot(f.shop),invoice='SUP-PO-'+randomUUID(),key=randomUUID(),input={...f.input,supplierInvoiceNumber:invoice,senderName:'Original sender',senderPhone:'09123',receiverName:'Receiver',orderedAt:'2026-10-01',expectedAt:'2026-10-20',notes:'Original note',total:1,paidAmount:1,actorId:'forged'}
  const created=await http('purchases',owner,input,key);assert.equal(created.status,201);const purchase=created.data.purchase
  assert.equal(purchase.status,'draft');assert.equal(purchase.paymentStatus,'unpaid');assert.equal(purchase.total,303);assert.equal(purchase.paidAmount,0);assert.equal(purchase.items[0].enteredQuantity,'2.5');assert.equal(purchase.items[0].baseQuantity,'2.5');assert.equal(purchase.items[0].quantity,3);assert.equal(purchase.items[0].lineTotal,253);assert.equal(purchase.items[0].product.units[0].unit.name,'Piece');assert.equal(purchase.items[0].plannedUnitCost,101);assert.equal(purchase.actorId,undefined)
  assert.deepEqual((await http('purchases',owner,input,key)).data,created.data)
  assert.equal((await http('purchases',owner,{...input,deliveryCost:51},key)).status,409)
  assert.equal((await http('purchases',owner,input,randomUUID())).status,400)
  const listed=await http('purchases?search='+encodeURIComponent(purchase.purchaseNumber)+'&status=draft',owner);assert.equal(listed.data.totalCount,1);assert.deepEqual(listed.data.purchases[0],purchase)
  const sent=await http('purchases/'+purchase.id+'/send',owner,{});assert.equal(sent.status,200);assert.equal(sent.data.purchase.status,'ordered')
  assert.equal((await http('purchases/'+purchase.id+'/send',owner,{})).status,400)
  assert.equal((await http('purchases?sort=invalid',owner)).status,400)
  const after=await snapshot(f.shop)
  for(const name of ['stock_batches','stock_balances','stock_movements','stock_reservations','pos_purchase_receipts','pos_purchase_payments'])assert.deepEqual(after[name],before[name])
  const audits=after.pos_audit.map(([,row])=>row).filter(row=>row.entityId===purchase.id);assert.equal(audits.length,2);assert.ok(audits.every(row=>row.actorId==='demo-owner'))
  for(const name of names)assert.deepEqual((await db.doc(`users/demo-owner/${name}/${legacyId}`).get()).data(),original)
})

test('Purchase creation rejects invalid scope, units, precision, serial fractions and overflow atomically, preserving source product snapshots and repeated lines',async()=>{
  const f=await fixture(),before=await snapshot(f.shop)
  const failures=[{...f.input,supplierId:randomUUID()},{...f.input,items:[{productId:randomUUID(),quantity:1,unitCost:100}]},{...f.input,items:[{productId:f.product.id,variantId:randomUUID(),quantity:1,unitCost:100}]},{...f.input,items:[{productId:f.product.id,unitId:randomUUID(),quantity:1,unitCost:100}]},{...f.input,items:[{productId:f.product.id,quantity:0.0001,unitCost:100}]},{...f.input,items:[{productId:f.product.id,quantity:2147483647,unitCost:2147483647}]},{...f.input,items:[f.input.items[0],{productId:randomUUID(),quantity:1,unitCost:100}]}]
  for(const input of failures)await assert.rejects(purchases.create(f.shop,input,'demo-owner',randomUUID()),error=>[400,404].includes(error.status))
  assert.deepEqual(await snapshot(f.shop),before)
  await table(f.shop,'pos_units').doc(f.product.units[0].unitId).update({precision:0})
  await assert.rejects(purchases.create(f.shop,f.input,'demo-owner',randomUUID()),/at most 0 decimal places/)
  await table(f.shop,'pos_units').doc(f.product.units[0].unitId).update({precision:3})
  await table(f.shop,'pos_products').doc(f.product.id).update({trackingMode:'SERIAL'})
  await assert.rejects(purchases.create(f.shop,f.input,'demo-owner',randomUUID()),/integer base quantity/)
  const conversionUnit={id:randomUUID(),shopId:f.shop,name:'Converted unit',precision:3,isActive:true}
  await table(f.shop,'pos_units').doc(conversionUnit.id).set(conversionUnit)
  await table(f.shop,'pos_products').doc(f.product.id).update({trackingMode:'NONE',units:[f.product.units[0],{id:randomUUID(),productId:f.product.id,unitId:conversionUnit.id,conversionFactor:'0.333333',isBase:false,canPurchase:true,canSell:true}]})
  const created=await purchases.create(f.shop,{supplierId:f.supplier.id,items:[{productId:f.product.id,unitId:conversionUnit.id,quantity:1.001,unitCost:100},{productId:f.product.id,quantity:2,unitCost:100}]},'demo-owner',randomUUID())
  assert.equal(created.purchase.items[0].baseQuantity,'0.334');assert.equal(created.purchase.items[0].conversionFactor,'0.333333');assert.equal(created.purchase.items[0].lineTotal,100);assert.equal(created.purchase.items.length,2);assert.equal(created.purchase.total,300)
  const links=(await table(f.shop,'pos_product_suppliers').get()).docs;assert.equal(links.length,1);assert.equal(links[0].data().lastUnitCost,100)
  // SQL Decimal(18,3) entered quantity can exceed Int32 when the converted
  // compatibility quantity fits. Applying the batch/JS integer bound to the
  // entered unit would silently narrow the reference purchase contract.
  const large=await purchases.create(f.shop,{supplierId:f.supplier.id,items:[{productId:f.product.id,unitId:conversionUnit.id,quantity:3000000000,unitCost:0}]},'demo-owner',randomUUID())
  assert.equal(large.purchase.items[0].enteredQuantity,'3000000000');assert.equal(large.purchase.items[0].baseQuantity,'999999000');assert.equal(large.purchase.total,0)
  const beforeOverflow=await snapshot(f.shop)
  await assert.rejects(purchases.create(f.shop,{supplierId:f.supplier.id,items:[{productId:f.product.id,quantity:2147483647.5,unitCost:0}]},'demo-owner',randomUUID()),{status:400});assert.deepEqual(await snapshot(f.shop),beforeOverflow)
  await table(f.shop,'pos_suppliers').doc(f.supplier.id).update({isActive:false})
  const inactive=await snapshot(f.shop);await assert.rejects(purchases.create(f.shop,f.input,'demo-owner',randomUUID()),{status:404});assert.deepEqual(await snapshot(f.shop),inactive)
})

test('Concurrent purchase invoices, retry keys and numbers serialize, and a saved purchase prevents later unit conversion edits',async()=>{
  const f=await fixture(),invoice='DUP-'+randomUUID(),input={...f.input,supplierInvoiceNumber:invoice}
  const race=await Promise.allSettled(Array.from({length:3},()=>purchases.create(f.shop,input,'demo-owner',randomUUID())))
  assert.equal(race.filter(row=>row.status==='fulfilled').length,1);for(const row of race.filter(row=>row.status==='rejected'))assert.equal(row.reason.status,400)
  const key=randomUUID(),same=await Promise.all(Array.from({length:4},()=>purchases.create(f.shop,f.input,'demo-owner',key)));assert.equal(new Set(same.map(row=>row.purchase.id)).size,1)
  const distinct=await Promise.all(Array.from({length:3},()=>purchases.create(f.shop,f.input,'demo-owner',randomUUID())));assert.equal(new Set(distinct.map(row=>row.purchase.purchaseNumber)).size,3)
  const all=(await purchases.list(f.shop,{})).purchases;assert.equal(all.length,5);assert.equal(new Set(all.map(row=>row.purchaseNumber)).size,5)
  const sends=await Promise.allSettled(Array.from({length:3},()=>purchases.send(f.shop,all[0].id,'demo-owner')));assert.equal(sends.filter(row=>row.status==='fulfilled').length,1)
  await assert.rejects(catalog.update(f.shop,f.product.id,{expectedVersion:f.product.version,units:[{name:'Replacement base',conversionFactor:1,isBase:true}]},'demo-owner',randomUUID()),{status:409})
  const persisted=(await table(f.shop,'pos_products').doc(f.product.id).get()).data();assert.equal(persisted.units[0].conversionFactor,'1')
})

test('Product supplier HTTP and purchase-updated links retain one scoped relationship and preserve optional fields on concurrent upsert',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example'),f=await fixture('belle-online'),path='product-suppliers'
  assert.equal((await http(path,other,{productId:f.product.id,supplierId:f.supplier.id})).status,403)
  assert.equal((await http(path,owner,{productId:randomUUID(),supplierId:f.supplier.id})).status,400)
  const input={productId:f.product.id,supplierId:f.supplier.id,lastUnitCost:88,notes:'Saved relation'}
  const created=await http(path,owner,input);assert.equal(created.status,201);assert.equal(created.data.productSupplier.supplier.id,f.supplier.id)
  const updated=await http(path,owner,{productId:f.product.id,supplierId:f.supplier.id,lastUnitCost:99});assert.equal(updated.data.productSupplier.id,created.data.productSupplier.id);assert.equal(updated.data.productSupplier.notes,'Saved relation')
  const reads=(await http(path,owner)).data.productSuppliers.filter(row=>row.productId===f.product.id);assert.equal(reads.length,1);assert.equal(reads[0].lastUnitCost,99)
  const upserts=await Promise.all(Array.from({length:4},(_,index)=>purchases.upsertProductSupplier(f.shop,{productId:f.product.id,supplierId:f.supplier.id,lastUnitCost:100+index},'demo-owner')));assert.equal(new Set(upserts.map(row=>row.productSupplier.id)).size,1)
  await purchases.create(f.shop,f.input,'demo-owner',randomUUID());const final=(await purchases.productSuppliers(f.shop)).productSuppliers.find(row=>row.productId===f.product.id);assert.equal(final.lastUnitCost,101);assert.equal(final.notes,'Saved relation')
})

test('Purchase creation versus an unused base-unit replacement commits one consistent unit identity without orphaned links or sequence writes',async()=>{
  const f=await fixture(),input={...f.input,items:[{...f.input.items[0],unitId:f.product.units[0].unitId}]}
  const result=await Promise.allSettled([purchases.create(f.shop,input,'demo-owner',randomUUID()),catalog.update(f.shop,f.product.id,{expectedVersion:1,units:[{name:'New base '+randomUUID(),conversionFactor:1,isBase:true}]},'demo-owner',randomUUID())])
  assert.equal(result.filter(row=>row.status==='fulfilled').length,1)
  const stored=(await table(f.shop,'pos_products').doc(f.product.id).get()).data(),orders=(await table(f.shop,'pos_purchases').get()).docs
  if(result[0].status==='fulfilled'){
    assert.equal(result[1].reason.status,409);assert.equal(orders.length,1);assert.equal(stored.units[0].unitId,input.items[0].unitId);assert.equal(orders[0].data().items[0].unitId,stored.units[0].unitId)
  }else{
    assert.equal(result[0].reason.status,400);assert.equal(orders.length,0);assert.notEqual(stored.units[0].unitId,input.items[0].unitId);assert.equal((await table(f.shop,'pos_product_suppliers').get()).size,0);assert.equal((await table(f.shop,'pos_sequences').get()).size,0)
  }
})

test('Purchase list keeps full filtered counts, source sort/page rules and nested receipt/payment/return evidence without rewriting it',async()=>{
  const f=await fixture(),created=(await purchases.create(f.shop,{...f.input,items:[{productId:f.product.id,quantity:1,unitCost:100}]},'demo-owner',randomUUID())).purchase
  const batch=db.batch()
  for(let index=0;index<52;index++){
    const key='list-'+String(index).padStart(3,'0'),line={...created.items[0],id:key+'-item',purchaseId:key,unitCost:100+index,plannedUnitCost:100+index,lineTotal:100+index}
    const row={...created,id:key,purchaseNumber:'PO-LIST-'+String(index).padStart(3,'0'),items:[line],total:150+index,status:index%2?'draft':'ordered'}
    delete row.supplier;delete row.receipts;delete row.payments;delete row.returns;delete line.product;delete line.variant
    batch.create(table(f.shop,'pos_purchases').doc(key),row)
  }
  batch.create(table(f.shop,'stock_batches').doc('nested-batch'),{id:'nested-batch',productId:f.product.id,baseQuantity:'1',unitCost:100})
  batch.create(table(f.shop,'pos_purchase_receipts').doc('nested-receipt'),{id:'nested-receipt',purchaseId:'list-000',purchaseItemId:'list-000-item',inventoryBatchId:'nested-batch',baseQuantity:'1'})
  batch.create(table(f.shop,'pos_purchase_payments').doc('nested-payment'),{id:'nested-payment',purchaseId:'list-000',amount:10,method:'Cash'})
  batch.create(table(f.shop,'pos_purchase_returns').doc('nested-return'),{id:'nested-return',purchaseId:'list-000',amount:5,reason:'Reader fixture'})
  await batch.commit();const before=await snapshot(f.shop)
  const first=await purchases.list(f.shop,{search:f.supplier.name.toUpperCase(),sort:'total',direction:'asc',pageSize:25,page:1}),third=await purchases.list(f.shop,{search:f.supplier.name,sort:'total',direction:'asc',pageSize:25,page:3})
  assert.equal(first.totalCount,53);assert.equal(first.purchases.length,25);assert.equal(third.purchases.length,3);assert.equal(first.purchases[0].total,150);assert.equal(third.purchases[2].total,201)
  const ordered=await purchases.list(f.shop,{status:'ordered',sort:'purchaseNumber',direction:'desc',pageSize:50});assert.equal(ordered.totalCount,26);assert.equal(ordered.purchases[0].id,'list-050')
  const nested=(await purchases.list(f.shop,{search:'PO-LIST-000'})).purchases[0];assert.equal(nested.receipts[0].inventoryBatch.id,'nested-batch');assert.equal(nested.payments[0].amount,10);assert.equal(nested.returns[0].reason,'Reader fixture');assert.equal(nested.items[0].product.units[0].unit.name,'Piece')
  assert.equal((await purchases.list(f.shop,{search:'not-present'})).totalCount,0)
  assert.deepEqual(await snapshot(f.shop),before)
})
