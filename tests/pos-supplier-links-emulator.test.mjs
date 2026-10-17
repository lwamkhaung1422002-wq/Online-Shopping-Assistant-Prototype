import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {createPosContacts} from '../../BelleLocal POS app/functions/src/pos/contacts.js'
import {createPosPurchases} from '../../BelleLocal POS app/functions/src/pos/purchases.js'
import {createPosCatalog} from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import {createPosSupplierPayments} from '../../BelleLocal POS app/functions/src/pos/supplier-payments.js'
import {signatureFixture} from './handover-signature-fixture.mjs'
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Supplier link tests require isolated local Firebase emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url))
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
initializeApp({projectId:'demo-belle-online'});const db=getFirestore(),auth=getAuth(),contacts=createPosContacts({db,getCreatorName:async()=>'Verified owner'}),purchases=createPosPurchases({db}),catalog=createPosCatalog({db}),invoicePayments=createPosSupplierPayments({db})
const table=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`),cash=amount=>({amount,method:'Cash',signatureDataUrl:signatureFixture()})
const delivery=(invoice,amount=50000)=>({invoiceNumber:invoice,deliveryName:'Original delivery',deliveryPhone:'0991234',receivedAt:'2026-10-01',dueAt:'2026-10-20',amount})
async function fixture(shop='supplier-links-'+randomUUID()){
  // The source POST creates an unlinked invoice, not a supplier entity. An
  // existing supplier identity is input, while linking below uses real writers.
  const supplier={id:randomUUID(),shopId:shop,name:'Linked supplier '+randomUUID(),phone:'0999999',contactPerson:'Original contact',email:null,address:'Original address',notes:'Original note',isActive:true,createdAt:'2026-10-01',updatedAt:'2026-10-01'}
  await table(shop,'pos_suppliers').doc(supplier.id).set(supplier)
  const product=await catalog.create(shop,{name:'Supplier link product '+randomUUID(),price:60000,cost:50000,units:[{name:'Piece',conversionFactor:1,isBase:true}]},'demo-owner',randomUUID())
  return {shop,supplier,product,input:{supplierId:supplier.id,items:[{productId:product.id,quantity:1,unitCost:50000}]}}
}
async function token(uid,email){try{await auth.createUser({uid,email,password:'Local-test-only-123!'})}catch(error){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(error.code))throw error}const result=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});assert.equal(result.status,200);return (await result.json()).idToken}
const base='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
async function http(path,owner,body,method=body===undefined?'GET':'POST'){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer '+owner}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()}}
async function snapshot(shop){const result={};for(const name of ['pos_suppliers','pos_supplier_delivery_records','pos_supplier_delivery_payments','pos_supplier_delivery_payment_reversals','pos_supplier_delivery_locks','pos_supplier_locks','pos_purchases','pos_purchase_receipts','pos_purchase_returns','pos_purchase_payments','pos_purchase_payment_reversals','pos_product_suppliers','pos_deleted_supplier_records','pos_deleted_purchase_records','pos_audit','pos_catalog_locks','pos_sequences','pos_requests','stock_batches','stock_balances','stock_movements','stock_reservations'])result[name]=(await table(shop,name).get()).docs.map(row=>[row.id,row.data()]);return result}

test('Linked supplier PATCH HTTP retains partial fields, case-sensitive identity, trusted new delivery creator and owner-only scope',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example');await auth.updateUser('demo-owner',{displayName:'Server-resolved owner'})
  const f=await fixture('belle-online'),path='suppliers/'+f.supplier.id,input={name:' Edited '+randomUUID()+' ',email:'CONTACT@EXAMPLE.COM',deliveryRecord:delivery('LINK-'+randomUUID()),receiverName:'Forged creator'}
  assert.equal((await http(path,undefined,input,'PATCH')).status,401);assert.equal((await http(path,other,input,'PATCH')).status,403)
  const updated=await http(path,owner,input,'PATCH');assert.equal(updated.status,200);assert.equal(updated.data.supplier.name,input.name.trim());assert.equal(updated.data.supplier.email,'contact@example.com');assert.equal(updated.data.supplier.phone,f.supplier.phone);assert.equal(updated.data.supplier.address,'Original address')
  const records=(await table(f.shop,'pos_supplier_delivery_records').where('supplierId','==',f.supplier.id).get()).docs;assert.equal(records.length,1);const record=records[0].data();assert.equal(record.receiverName,'Server-resolved owner');assert.equal(record.supplierName,input.name.trim());assert.equal(record.supplierPhone,f.supplier.phone)
  assert.equal((await table(f.shop,'pos_audit').where('entityId','==',f.supplier.id).get()).size,0) // source PATCH has no audit
  const before=await snapshot(f.shop);assert.equal((await http(path,owner,{name:'Will roll back',deliveryRecord:delivery('BAD-'+randomUUID(),49999)},'PATCH')).status,400);assert.deepEqual(await snapshot(f.shop),before)
  assert.equal((await http('suppliers/'+randomUUID(),owner,{},'PATCH')).status,404)
  const otherSupplier={...f.supplier,id:randomUUID(),name:updated.data.supplier.name};await table(f.shop,'pos_suppliers').doc(otherSupplier.id).set(otherSupplier)
  assert.equal((await http(path,owner,{notes:'Collision rollback'},'PATCH')).status,409)
  const differentCase=await http(path,owner,{name:updated.data.supplier.name.toUpperCase()},'PATCH');assert.equal(differentCase.status,200)
  const inactive=await http(path,owner,{isActive:false},'PATCH');assert.equal(inactive.data.supplier.isActive,false)
  await assert.rejects(purchases.create(f.shop,f.input,'demo-owner',randomUUID()),{status:404})
})

test('Linked supplier edits target only the latest invoice, retain original creator/name snapshots, permit existing payments and roll back conflicts',async()=>{
  const f=await fixture(),first=delivery('FIRST-'+randomUUID(),50000)
  await contacts.saveSupplier(f.shop,f.supplier.id,{deliveryRecord:first},'demo-owner');const early=(await contacts.suppliers(f.shop,{})).suppliers[0].deliveryRecords[0]
  const later={...early,id:randomUUID(),invoiceNumber:'LATER-'+randomUUID(),receivedAt:'2026-10-03',receiverName:'Original later creator'};await table(f.shop,'pos_supplier_delivery_records').doc(later.id).set(later)
  const invoicePayment=(await invoicePayments.receive(f.shop,later.id,cash(10000),'demo-owner',randomUUID())).payment
  const purchase=(await purchases.create(f.shop,f.input,'demo-owner',randomUUID())).purchase;await purchases.pay(f.shop,purchase.id,cash(1000),'demo-owner',randomUUID())
  const edited=await contacts.saveSupplier(f.shop,f.supplier.id,{name:'Updated contact',phone:'099000',deliveryRecord:{...delivery(later.invoiceNumber,60000),receivedAt:'2026-10-04'}},'demo-owner');assert.equal(edited.supplier.name,'Updated contact')
  const saved=(await table(f.shop,'pos_supplier_delivery_records').doc(later.id).get()).data();assert.equal(saved.amount,60000);assert.equal(saved.receiverName,'Original later creator');assert.equal(saved.supplierName,f.supplier.name);assert.equal(saved.supplierPhone,f.supplier.phone)
  assert.deepEqual((await table(f.shop,'pos_supplier_delivery_records').doc(early.id).get()).data(),early);assert.deepEqual((await table(f.shop,'pos_supplier_delivery_payments').doc(invoicePayment.id).get()).data(),invoicePayment)
  const before=await snapshot(f.shop)
  await assert.rejects(contacts.saveSupplier(f.shop,f.supplier.id,{address:'Must roll back',deliveryRecord:delivery(later.invoiceNumber,59999)},'demo-owner'),{status:400})
  await assert.rejects(contacts.saveSupplier(f.shop,f.supplier.id,{notes:'Must roll back',deliveryRecord:delivery(early.invoiceNumber,60000)},'demo-owner'),{status:409});assert.deepEqual(await snapshot(f.shop),before)
  const noCreator=createPosContacts({db});await noCreator.saveSupplier(f.shop,f.supplier.id,{notes:'Creator lookup unnecessary'},'demo-owner')
  const missing=await fixture();const untouched=await snapshot(missing.shop);await assert.rejects(noCreator.saveSupplier(missing.shop,missing.supplier.id,{name:'Rollback',deliveryRecord:delivery('MISSING')},'demo-owner'),{status:400});assert.deepEqual(await snapshot(missing.shop),untouched)
})

test('Payable purchase HTTP reuses one received supplier invoice, preserves its dates/total and never receives stock or mutates legacy originals',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example'),f=await fixture('belle-online'),invoice='PAYABLE-'+randomUUID()
  await contacts.saveSupplier(f.shop,f.supplier.id,{deliveryRecord:delivery(invoice)},'demo-owner');const record=(await contacts.suppliers(f.shop,{search:f.supplier.name})).suppliers[0].deliveryRecords[0],path='supplier-delivery-records/'+record.id+'/payable-purchase'
  const legacyId='payable-legacy-'+randomUUID(),names=['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta'],original={amount:34500,status:'reserved',paymentStatus:'unpaid'};for(const name of names)await db.doc(`users/demo-owner/${name}/${legacyId}`).set(original)
  const before=await snapshot(f.shop);assert.equal((await http(path,undefined,{})).status,401);assert.equal((await http(path,other,{})).status,403)
  const opened=await http(path,owner,{});assert.equal(opened.status,201);const purchase=opened.data.purchase
  assert.match(purchase.purchaseNumber,/^SUP-\d{5}$/);assert.equal(purchase.status,'received');assert.equal(purchase.paymentStatus,'unpaid');assert.equal(purchase.total,50000);assert.equal(purchase.paidAmount,0);assert.equal(purchase.notes,'Created from supplier delivery record.');assert.equal(purchase.orderedAt,record.receivedAt);assert.equal(purchase.expectedAt,record.dueAt);assert.equal(purchase.receivedAt,record.receivedAt);assert.deepEqual(purchase.items,[]);assert.deepEqual(purchase.receipts,[])
  assert.deepEqual((await http(path,owner,{})).data,opened.data)
  const paid=await purchases.pay(f.shop,purchase.id,cash(10000),'demo-owner',randomUUID());assert.deepEqual((await http(path,owner,{})).data,paid)
  await contacts.saveSupplier(f.shop,f.supplier.id,{deliveryRecord:delivery(invoice,60000)},'demo-owner');const reused=(await http(path,owner,{})).data.purchase;assert.equal(reused.id,purchase.id);assert.equal(reused.total,50000) // source does not rebase an existing purchase
  const rows=(await contacts.deliveryInvoices(f.shop,{search:f.supplier.name})).records.filter(row=>row.purchase?.id===purchase.id||row.delivery?.id===record.id);assert.equal(rows.length,2) // source retains both records
  const after=await snapshot(f.shop);for(const name of ['stock_batches','stock_balances','stock_movements','stock_reservations','pos_purchase_receipts'])assert.deepEqual(after[name],before[name])
  const audit=after.pos_audit.map(([,row])=>row).filter(row=>row.entityId===purchase.id&&row.action==='purchase.create_from_supplier_delivery');assert.equal(audit.length,1);assert.equal(audit[0].actorId,'demo-owner');assert.deepEqual(audit[0].metadata,{deliveryRecordId:record.id})
  for(const name of names)assert.deepEqual((await db.doc(`users/demo-owner/${name}/${legacyId}`).get()).data(),original)
  await assert.rejects(purchases.openPayable(f.shop,randomUUID(),'demo-owner'),{status:404})
  const unlinked=(await contacts.saveDelivery(f.shop,null,{name:'Unlinked',phone:'09999',deliveryRecord:delivery('UNLINK-'+randomUUID())},'demo-owner')).record;await assert.rejects(purchases.openPayable(f.shop,unlinked.id,'demo-owner'),{status:400})
})

test('Supplier deletion cascades active purchase relationships, archives evidence, detaches delivery invoices and leaves stock and original payments unchanged',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example'),f=await fixture('belle-online')
  await contacts.saveSupplier(f.shop,f.supplier.id,{deliveryRecord:delivery('DELETE-'+randomUUID())},'demo-owner');const record=(await contacts.suppliers(f.shop,{search:f.supplier.name})).suppliers[0].deliveryRecords[0],payment=(await invoicePayments.receive(f.shop,record.id,cash(10000),'demo-owner',randomUUID())).payment
  const purchase=(await purchases.create(f.shop,f.input,'demo-owner',randomUUID())).purchase
  // Explicit receipt/return inputs exercise the relationship cascade only; their
  // pending inventory writers are not claimed by these seeded relationships.
  const batch={id:randomUUID(),productId:f.product.id,baseQuantity:'1',unitCost:50000},receipt={id:randomUUID(),purchaseId:purchase.id,purchaseItemId:purchase.items[0].id,inventoryBatchId:batch.id,baseQuantity:'1'},returned={id:randomUUID(),purchaseId:purchase.id,purchaseItemId:purchase.items[0].id,inventoryBatchId:batch.id,quantity:1,amount:50000}
  await table(f.shop,'stock_batches').doc(batch.id).set(batch);await table(f.shop,'pos_purchase_receipts').doc(receipt.id).set(receipt);await table(f.shop,'pos_purchase_returns').doc(returned.id).set(returned)
  const before=await snapshot(f.shop),path='suppliers/'+f.supplier.id
  assert.equal((await http(path,other,undefined,'DELETE')).status,403);const deleted=await http(path,owner,undefined,'DELETE');assert.equal(deleted.status,200);assert.deepEqual(deleted.data,{supplier:before.pos_suppliers.find(([key])=>key===f.supplier.id)[1],deleted:true})
  assert.equal((await table(f.shop,'pos_suppliers').doc(f.supplier.id).get()).exists,false);assert.equal((await table(f.shop,'pos_purchases').doc(purchase.id).get()).exists,false);assert.equal((await table(f.shop,'pos_purchase_receipts').doc(receipt.id).get()).exists,false);assert.equal((await table(f.shop,'pos_purchase_returns').doc(returned.id).get()).exists,false)
  const archive=(await table(f.shop,'pos_deleted_purchase_records').doc(purchase.id).get()).data();assert.deepEqual(archive.receipts,[receipt]);assert.deepEqual(archive.returns,[returned]);assert.equal(archive.purchase.items[0].productName,f.product.name);assert.equal(archive.actorId,'demo-owner')
  const supplierArchive=(await table(f.shop,'pos_deleted_supplier_records').doc(f.supplier.id).get()).data();assert.deepEqual(supplierArchive.purchaseIds,[purchase.id]);assert.equal(supplierArchive.productSuppliers.length,1)
  const detached=(await table(f.shop,'pos_supplier_delivery_records').doc(record.id).get()).data();assert.deepEqual(detached,{...record,supplierId:null});assert.deepEqual((await table(f.shop,'pos_supplier_delivery_payments').doc(payment.id).get()).data(),payment)
  for(const name of ['stock_batches','stock_balances','stock_movements','stock_reservations','pos_sequences','pos_catalog_locks'])assert.deepEqual((await snapshot(f.shop))[name],before[name])
  assert.equal((await table(f.shop,'pos_product_suppliers').where('supplierId','==',f.supplier.id).get()).size,0)
  assert.equal((await http(path,owner,undefined,'DELETE')).status,404)
  const audit=(await table(f.shop,'pos_audit').where('entityId','==',f.supplier.id).get()).docs.map(row=>row.data()).find(row=>row.action==='supplier.delete');assert.deepEqual(audit.metadata,{name:f.supplier.name});assert.equal(audit.actorId,'demo-owner')
})

test('Linked supplier uniqueness, payable retries and deletion versus purchase/payment contention serialize without orphaned relationships',async()=>{
  const f=await fixture(),second={...f.supplier,id:randomUUID(),name:'Other supplier'};await table(f.shop,'pos_suppliers').doc(second.id).set(second)
  const name='Concurrent identity '+randomUUID(),edits=await Promise.allSettled([f.supplier.id,second.id].map(key=>contacts.saveSupplier(f.shop,key,{name,phone:'099000'},'demo-owner')));assert.equal(edits.filter(row=>row.status==='fulfilled').length,1);assert.equal(edits.find(row=>row.status==='rejected').reason.status,409)
  await contacts.saveSupplier(f.shop,f.supplier.id,{deliveryRecord:delivery('RACE-'+randomUUID())},'demo-owner');const record=(await contacts.suppliers(f.shop,{})).suppliers.find(row=>row.id===f.supplier.id).deliveryRecords[0]
  const opened=await Promise.all(Array.from({length:4},()=>purchases.openPayable(f.shop,record.id,'demo-owner')));assert.equal(new Set(opened.map(row=>row.purchase.id)).size,1)
  const purchase=opened[0].purchase,race=await Promise.allSettled([contacts.removeSupplier(f.shop,f.supplier.id,'demo-owner'),purchases.pay(f.shop,purchase.id,cash(1000),'demo-owner',randomUUID())]);assert.equal(race.filter(row=>row.status==='fulfilled').length,1)
  if(race[0].status==='fulfilled'){assert.equal(race[1].reason.status,404);assert.equal((await table(f.shop,'pos_purchases').doc(purchase.id).get()).exists,false)}else{assert.equal(race[0].reason.status,400);assert.equal((await table(f.shop,'pos_purchases').doc(purchase.id).get()).data().paidAmount,1000)}
  for(let round=0;round<2;round++){
    const fresh=await fixture(),competing=await Promise.allSettled([contacts.removeSupplier(fresh.shop,fresh.supplier.id,'demo-owner'),purchases.create(fresh.shop,fresh.input,'demo-owner',randomUUID())])
    const exists=(await table(fresh.shop,'pos_suppliers').doc(fresh.supplier.id).get()).exists;assert.equal(exists,false)
    assert.equal((await table(fresh.shop,'pos_purchases').get()).size,0);assert.equal((await table(fresh.shop,'pos_product_suppliers').get()).size,0)
    if(competing[1].status==='fulfilled')assert.equal((await table(fresh.shop,'pos_deleted_purchase_records').doc(competing[1].value.purchase.id).get()).exists,true);else assert.equal(competing[1].reason.status,404)
  }
})

test('Reversed purchase receipts still prevent deletion; cancelled linked invoices follow source payable behavior and oversized archives roll back completely',async()=>{
  const f=await fixture();await contacts.saveSupplier(f.shop,f.supplier.id,{deliveryRecord:delivery('CANCELLED-'+randomUUID())},'demo-owner');const record=(await contacts.suppliers(f.shop,{})).suppliers[0].deliveryRecords[0]
  await contacts.cancelDelivery(f.shop,record.id,{reason:'Cancelled delivery'},'demo-owner');const opened=(await purchases.openPayable(f.shop,record.id,'demo-owner')).purchase;assert.equal(opened.status,'received') // no cancelled-delivery guard in this source route
  const paid=(await purchases.pay(f.shop,opened.id,cash(10000),'demo-owner',randomUUID())).purchase,payment=paid.payments[0];await purchases.reversePayment(f.shop,opened.id,payment.id,{reason:'Retained receipt'},'demo-owner')
  const before=await snapshot(f.shop);await assert.rejects(contacts.removeSupplier(f.shop,f.supplier.id,'demo-owner'),{status:400});assert.deepEqual(await snapshot(f.shop),before)
  await contacts.saveSupplier(f.shop,f.supplier.id,{isActive:false},'demo-owner');await assert.rejects(purchases.openPayable(f.shop,record.id,'demo-owner'),{status:400})
  const huge=await fixture(),purchase=(await purchases.create(huge.shop,huge.input,'demo-owner',randomUUID())).purchase;await table(huge.shop,'pos_purchases').doc(purchase.id).update({notes:'x'.repeat(850001)})
  const untouched=await snapshot(huge.shop);await assert.rejects(contacts.removeSupplier(huge.shop,huge.supplier.id,'demo-owner'),{status:409});assert.deepEqual(await snapshot(huge.shop),untouched)
})
