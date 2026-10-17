import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {createPosContacts} from '../../BelleLocal POS app/functions/src/pos/contacts.js'
import {runPosTransaction} from '../../BelleLocal POS app/functions/src/pos/transaction.js'
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Contact tests require isolated local Auth/Firestore emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url))
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
initializeApp({projectId:'demo-belle-online'});const db=getFirestore(),auth=getAuth()
const base='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
async function token(uid,email){try{await auth.createUser({uid,email,password:'Local-test-only-123!'})}catch(error){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(error.code))throw error};const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});assert.equal(response.status,200);return (await response.json()).idToken}
async function http(path,method='GET',body,owner){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer '+owner}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:response.status===204?null:await response.json()}}

test('Retails customer HTTP CRUD preserves optional contact fields, duplicate phones, owner privacy, query contracts and empty report',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example')
  assert.equal((await http('customers')).status,401);assert.equal((await http('customers','GET',undefined,other)).status,403)
  assert.equal((await http('customers','POST',{name:' '},owner)).status,400)
  assert.equal((await http('customers','POST',{name:'Invalid',email:'bad-email'},owner)).status,400)
  const name='Customer HTTP '+randomUUID(),phone='09'+randomUUID().slice(0,8)
  const first=await http('customers','POST',{name:' '+name+' ',phone,email:'UPPER@EXAMPLE.COM',city:' Yangon ',address:' Street '},owner)
  assert.equal(first.status,201);const customer=first.data.customer
  assert.equal(customer.email,'upper@example.com');assert.equal(customer.city,'Yangon');assert.equal(customer.notes,null)
  const duplicate=await http('customers','POST',{name:name+' duplicate',phone},owner);assert.equal(duplicate.status,201)
  assert.equal((await http('customers?search='+phone+'&includeStats=true','GET',undefined,owner)).data.totalCount,2)
  const update=await http('customers/'+customer.id,'PATCH',{name:name+' edited',address:''},owner)
  assert.equal(update.status,200);assert.equal(update.data.customer.phone,phone);assert.equal(update.data.customer.address,'')
  const detail=await http('customers/'+customer.id,'GET',undefined,owner);assert.equal(detail.data.customer.hasHistory,false)
  const report=await http('customers/'+customer.id+'/transaction-report','GET',undefined,owner)
  assert.equal(report.status,200);assert.deepEqual(report.data.invoices,[]);assert.equal(report.data.summary.invoiceCount,0)
  assert.equal((await http('customers?includeStats=yes','GET',undefined,owner)).status,400)
  assert.equal((await http('customers?pageSize=26','GET',undefined,owner)).status,400)
  assert.equal((await http('customers/'+customer.id+'/transaction-report?from=2026-02-30','GET',undefined,owner)).status,400)
  assert.equal((await http('customers/'+customer.id,'DELETE',undefined,other)).status,403)
  assert.equal((await http('customers/'+customer.id,'DELETE',undefined,owner)).status,204)
  assert.equal((await http('customers/'+customer.id,'GET',undefined,owner)).status,404)
  assert.equal((await http('customers/'+duplicate.data.customer.id,'DELETE',undefined,owner)).status,204)
})

test('customer financial projection preserves discounted returns, allocated/void settlements, COD, cancelled history and Myanmar day bounds',async()=>{
  const shop='contacts-'+randomUUID(),table=(name)=>db.collection(`onlineShopV2/${shop}/${name}`),contacts=createPosContacts({db})
  const {customer}=await contacts.saveCustomer(shop,null,{name:'Finance customer'},'demo-owner')
  const legacy=db.doc('users/demo-owner/orders/customer-legacy-'+randomUUID()),original={total:34500,paymentStatus:'unpaid',customer:{name:'Legacy'}};await legacy.set(original)
  const order=(key,total,subtotal,discount,fulfillmentStatus,extra={})=>({id:key,customerId:customer.id,shopId:shop,orderNumber:key,total,subtotal,discount,deliveryFee:5,fulfillmentStatus,cancelledAt:null,createdAt:'2026-10-01T18:00:00Z',items:[{id:key+'-item',quantity:2,baseQuantity:'2',lineTotal:subtotal}],...extra})
  for(const value of [order('completed',95,100,10,'completed'),order('returned',200,200,0,'completed'),order('cod',200,200,0,'reserved',{collectionArrangement:'COD'}),order('cancelled',300,300,0,'cancelled',{cancelledAt:'2026-10-02T01:00:00Z'})])await table('pos_orders').doc(value.id).set(value)
  await table('pos_customer_returns').doc('return-1').set({orderItemId:'completed-item',quantity:'1'})
  await table('pos_customer_returns').doc('return-2').set({orderItemId:'returned-item',quantity:'2'})
  const payment=(key,amount,extra={})=>({id:key,amount,paidAt:'2026-10-02T02:00:00Z',...extra})
  for(const row of [payment('direct',20,{orderId:'completed'}),payment('allocated',15,{orderIds:'["completed"]',allocations:'[{"orderId":"completed","amount":15}]'}),payment('void',5,{scope:'sale.void',orderIds:'completed',allocations:'[{"orderId":"completed","amount":5}]'}),payment('malformed',900,{orderIds:'completed',allocations:'{bad json'}),payment('cod-payment',50,{orderId:'cod'}),payment('cancelled-payment',100,{orderId:'cancelled'})])await table('pos_payments').doc(row.id).set(row)
  const summary=await contacts.customerReport(shop,customer.id,{from:'2026-10-02',to:'2026-10-02'})
  assert.deepEqual(summary.summary,{totalPurchases:250,totalPaid:80,outstanding:20,codPending:150,pendingOrders:1,invoiceCount:4})
  assert.equal(summary.invoices.find((row)=>row.orderId==='completed').effectiveAmount,50)
  assert.equal(summary.invoices.find((row)=>row.orderId==='completed').paymentCount,3)
  assert.equal(summary.invoices.find((row)=>row.orderId==='cod').paymentStatus,'COD pending')
  assert.equal(summary.invoices.find((row)=>row.orderId==='cancelled').paidAmount,100)
  assert.equal(summary.invoices.find((row)=>row.orderId==='cancelled').effectiveAmount,0)
  assert.equal((await contacts.customerReport(shop,customer.id,{from:'2026-10-01',to:'2026-10-01'})).invoices.length,0)
  assert.equal((await contacts.customerReport(shop,customer.id,{search:'completed'})).invoices.length,1)
  assert.equal((await contacts.customers(shop,{includeStats:'true'})).customers[0].totalAmount,50)
  assert.equal((await contacts.customers(shop,{includeStats:'true'})).customers[0].visitCount,2)
  assert.equal((await contacts.customers(shop)).customers[0].visitCount,0)
  await assert.rejects(contacts.removeCustomer(shop,customer.id,'demo-owner'),{status:409})
  assert.deepEqual((await legacy.get()).data(),original)
  // This simulates the customer read required by the future order transaction;
  // it does not claim that the still-pending Create Order API is implemented.
  for(let round=0;round<2;round++){
    const created=(await contacts.saveCustomer(shop,null,{name:'Customer race'},'demo-owner')).customer
    const race=await Promise.allSettled([
      contacts.removeCustomer(shop,created.id,'demo-owner'),
      runPosTransaction(db,async(tx)=>{await contacts.requireCustomer(tx,shop,created.id);tx.create(table('pos_orders').doc('customer-race-'+round),{customerId:created.id})}),
    ])
    assert.equal(race.filter((row)=>row.status==='fulfilled').length,1)
    const remaining=await table('pos_customers').doc(created.id).get()
    if(race[1].status==='fulfilled'){assert.equal(remaining.exists,true);assert.equal(race[0].reason.status,409)}else{assert.equal(remaining.exists,false);assert.equal(race[1].reason.status,404)}
  }
})

const supplierBody=(invoice)=>({name:'Supply '+randomUUID().slice(0,8),phone:'099999999',receiverName:'Forged creator',deliveryRecord:{invoiceNumber:invoice,deliveryName:'Truck 1',deliveryPhone:'091234567',receivedAt:'2026-10-01',dueAt:'2026-10-12',amount:50000,receiverName:'Forged nested creator'}})
test('supplier HTTP creation uses trusted owner name, unique invoice, source list/detail/edit and reasoned cancellation contracts',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example')
  await auth.updateUser('demo-owner',{displayName:'Demo Belle Owner'})
  assert.equal((await http('suppliers')).status,401);assert.equal((await http('supplier-delivery-invoices','GET',undefined,other)).status,403)
  const body=supplierBody('HTTP-'+randomUUID()),first=await http('suppliers','POST',body,owner)
  assert.equal(first.status,201);const record=first.data.record
  assert.equal(record.receiverName,'Demo Belle Owner');assert.equal(record.supplierId,null)
  assert.equal((await http('suppliers','POST',body,owner)).status,409)
  assert.equal((await http('suppliers','POST',{...body,deliveryRecord:undefined},owner)).status,400)
  assert.equal((await http('suppliers','POST',{...body,deliveryRecord:{...body.deliveryRecord,dueAt:'2026-09-01'}},owner)).status,400)
  const detail=await http('supplier-delivery-records/'+record.id,'GET',undefined,owner)
  assert.equal(detail.data.record.activePaid,0);assert.equal(detail.data.record.remaining,50000);assert.equal(detail.data.record.invoiceStatus,'Credit')
  const edited=await http('supplier-delivery-records/'+record.id,'PATCH',{...body,name:'Changed supplier',deliveryRecord:{...body.deliveryRecord,amount:40000}},owner)
  assert.equal(edited.status,200);assert.equal(edited.data.record.receiverName,'Demo Belle Owner')
  const listed=await http('supplier-delivery-records?search='+body.deliveryRecord.invoiceNumber,'GET',undefined,owner)
  assert.equal(listed.data.totalCount,1);assert.equal(listed.data.records[0].remaining,40000)
  const invoices=await http('supplier-delivery-invoices?search='+body.deliveryRecord.invoiceNumber,'GET',undefined,owner)
  assert.equal(invoices.data.summary.amount,40000);assert.equal(invoices.data.records[0].kind,'delivery')
  assert.equal((await http('supplier-delivery-records/'+record.id,'DELETE',undefined,owner)).status,400)
  assert.equal((await http('supplier-delivery-records/'+record.id+'/cancel','POST',{reason:''},owner)).status,400)
  assert.equal((await http('supplier-delivery-records/'+record.id+'/cancel','POST',{reason:'Invoice entered incorrectly'},owner)).status,200)
  assert.equal((await http('supplier-delivery-records/'+record.id,'PATCH',body,owner)).status,400)
  assert.equal((await http('supplier-delivery-invoices?search='+body.deliveryRecord.invoiceNumber+'&status=Cancel','GET',undefined,owner)).data.summary.amount,0)
})

test('supplier invoice contention and active/reversed payment guards preserve original creator and append-only evidence',async()=>{
  const shop='suppliers-'+randomUUID(),table=(name)=>db.collection(`onlineShopV2/${shop}/${name}`),contacts=createPosContacts({db,getCreatorName:async()=>'Original Owner'})
  const body=supplierBody('COMPETE-'+randomUUID())
  const race=await Promise.allSettled([1,2,3].map(()=>contacts.saveDelivery(shop,null,body,'demo-owner')))
  assert.equal(race.filter((row)=>row.status==='fulfilled').length,1)
  for(const row of race.filter((row)=>row.status==='rejected'))assert.equal(row.reason.status,409,row.reason.stack)
  const record=race.find((row)=>row.status==='fulfilled').value.record
  const originalPayment={id:'payment',deliveryRecordId:record.id,amount:20000,paidAt:'2026-10-02T01:00:00Z',reversedAt:null}
  await table('pos_supplier_delivery_payments').doc('payment').set(originalPayment)
  assert.equal((await contacts.deliveryRecord(shop,record.id)).record.remaining,30000)
  await assert.rejects(contacts.saveDelivery(shop,record.id,body,'demo-other'),{status:400})
  await assert.rejects(contacts.cancelDelivery(shop,record.id,{reason:'Blocked'},'demo-owner'),{status:400})
  const reversal={id:'reversal',originalPaymentId:'payment',reason:'Duplicate payment',reversedAt:'2026-10-03T01:00:00Z'}
  await table('pos_supplier_delivery_payment_reversals').doc('reversal').set(reversal)
  const projected=(await contacts.deliveryRecord(shop,record.id)).record
  assert.equal(projected.activePaid,0);assert.equal(projected.remaining,50000);assert.equal(projected.allowedActions.edit,true)
  const otherCreator=createPosContacts({db,getCreatorName:async()=>'Another Owner'})
  const edited=await otherCreator.saveDelivery(shop,record.id,{...body,deliveryRecord:{...body.deliveryRecord,amount:45000}},'demo-other')
  assert.equal(edited.record.receiverName,'Original Owner')
  assert.deepEqual((await table('pos_supplier_delivery_payments').doc('payment').get()).data(),originalPayment)
  assert.deepEqual((await table('pos_supplier_delivery_payment_reversals').doc('reversal').get()).data(),reversal)
  await assert.rejects(createPosContacts({db}).saveDelivery(shop,null,supplierBody('MISSING-'+randomUUID()),'demo-owner'),{status:400})
})
