import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {createPosPaymentHistory} from '../../BelleLocal POS app/functions/src/pos/payment-history.js'
import {createPosOrders} from '../../BelleLocal POS app/functions/src/pos/orders.js'
import {createPosCatalog} from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import {createPosContacts} from '../../BelleLocal POS app/functions/src/pos/contacts.js'
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Payment history tests require isolated local Firebase emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url))
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
initializeApp({projectId:'demo-belle-online'})
const db=getFirestore(),auth=getAuth(),history=createPosPaymentHistory({db})
const table=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`)
const base='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
async function token(uid,email){try{await auth.createUser({uid,email,password:'Local-test-only-123!'})}catch(error){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(error.code))throw error}const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});assert.equal(response.status,200);return (await response.json()).idToken}
async function http(path,owner,body,key){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer '+owner}:{}),...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()}}
const date='2026-10-10T03:00:00.000Z',later='2026-10-11T03:00:00.000Z'
const order=(id,extra={})=>({id,orderNumber:'INV-'+id,customerId:'customer',paymentTracking:true,saleType:'IN_STORE',collectionArrangement:'NONE',fulfillmentStatus:'completed',subtotal:100,total:100,discount:0,createdAt:date,items:[{id:'item-'+id,productId:'fixture',quantity:1,baseQuantity:'1',lineTotal:100}],...extra})
const payment=(id,orderId,amount,extra={})=>({id,orderId,amount,type:amount<0?'refund':'payment',method:'Cash',createdAt:later,paidAt:later,originalPaymentId:null,...extra})
async function seed(shop,name,values){const batch=db.batch();for(const value of values)batch.set(table(shop,name).doc(value.id),value);await batch.commit()}
async function snapshot(shop){const values={};for(const name of ['pos_orders','pos_customers','pos_payments','pos_customer_returns','pos_supplier_delivery_records','pos_supplier_delivery_payments','pos_supplier_delivery_payment_reversals','pos_expenses','pos_audit'])values[name]=(await table(shop,name).get()).docs.map((value)=>[value.id,value.data()]);return values}

test('owner Payment HTTP worklist/history reads a real checkout and final collection, validates queries and preserves initial receipts',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example')
  assert.equal((await http('payment-history')).status,401)
  assert.equal((await http('payment-history',other)).status,403)
  for(const query of ['includeCustomerInvoices=invalid','from=2026-02-30','from=2026-10-11&to=2026-10-10','paged=true&pageSize=101'])assert.equal((await http('payment-history?'+query,owner)).status,400)
  const catalog=createPosCatalog({db}),orders=createPosOrders({db}),contacts=createPosContacts({db})
  const product=await catalog.create('belle-online',{name:'Worklist '+randomUUID(),price:5000,cost:2000,units:[{name:'Piece',isBase:true,conversionFactor:1}],openingStock:{quantity:2,unitCost:2000}},'demo-owner',randomUUID())
  const customer=(await contacts.saveCustomer('belle-online',null,{name:'Worklist customer '+randomUUID(),phone:'099999'},'demo-owner')).customer
  const created=(await orders.create('belle-online',{saleType:'IN_STORE',paymentMode:'PARTIAL',customerId:customer.id,initialPayment:{method:'Cash',amount:1000},items:[{productId:product.id,quantity:1}]},'demo-owner',randomUUID(),{checkout:true})).order
  const url='payment-history?paged=true&includeCustomerInvoices=true&search='+created.orderNumber
  const first=await http(url,owner);assert.equal(first.status,200,JSON.stringify(first.data))
  const row=first.data.records.find((value)=>value.apiId===created.id)
  assert.equal(row.status,'Partial');assert.equal(row.amount,5000);assert.equal(row.remainingAmount,4000);assert.equal(row.customerName,customer.name)
  assert.equal(row.paymentOptions[0].amount,1000);assert.equal(first.data.summary.outstanding,4000)
  const originalPayment=created.payments[0],original=(await table('belle-online','pos_payments').doc(originalPayment.id).get()).data()
  const received=await http('orders/'+created.id+'/payments',owner,{method:'Cash',scope:'credit-settlement'},randomUUID());assert.equal(received.status,201)
  const result=await http(url,owner),settled=result.data.records.find((value)=>value.apiId===created.id)
  assert.equal(settled.status,'Paid');assert.equal(settled.remainingAmount,0);assert.equal(settled.paymentOptions.length,2)
  const receipts=await http('payment-history?view=history&paged=true&search='+created.orderNumber,owner)
  assert.equal(receipts.data.records.length,2);assert.equal(receipts.data.summary.amount,5000)
  assert.deepEqual(new Set(receipts.data.records.map((value)=>value.paymentId)),new Set([originalPayment.id,received.data.payment.id]))
  assert.deepEqual((await table('belle-online','pos_payments').doc(originalPayment.id).get()).data(),original)
})

test('Payment projections retain source COD/return/retained income, reversal and expense history rules without changing any documents',async()=>{
  const shop='payment-read-'+randomUUID()
  await seed(shop,'pos_customers',[{id:'customer',name:'Changed contact'}])
  await seed(shop,'pos_orders',[
    order('partial',{customerSnapshot:{name:'Saved buyer'}}),order('cod',{saleType:'ONLINE',collectionArrangement:'COD',fulfillmentStatus:'reserved'}),order('returned'),
    order('retained',{saleType:'ONLINE',fulfillmentStatus:'cancelled',retainedIncomeAmount:80,retainedIncomeAt:later}),
    order('pending',{saleType:'ONLINE',cancellationState:'RETURN_PENDING',cancellationRequestedAt:later}),
    order('pending-empty',{saleType:'ONLINE',cancellationState:'REFUND_REQUIRED'}),
    order('cancelled',{fulfillmentStatus:'cancelled'}),order('nontracked',{paymentTracking:false}),order('walkin',{paymentTracking:false,customerId:null}),
    order('boundary-before',{createdAt:'2026-10-09T17:29:59.999Z'}),order('boundary-start',{createdAt:'2026-10-09T17:30:00.000Z'}),
  ])
  await seed(shop,'pos_payments',[
    payment('p-partial','partial',40),payment('p-returned','returned',50),payment('p-retained','retained',100),payment('r-retained','retained',-20,{originalPaymentId:'p-retained',reason:'Returned part'}),
    payment('p-pending','pending',60),payment('r-pending','pending',-10,{originalPaymentId:'p-pending'}),payment('p-nontracked','nontracked',100),
    payment('allocated',null,40,{scope:'cod-settlement',orderIds:JSON.stringify(['cod']),allocations:JSON.stringify([{orderId:'cod',amount:40}])}),
    payment('ignored-type','partial',0,{type:'other'}),
  ])
  await seed(shop,'pos_customer_returns',[{id:'return-half',orderId:'returned',orderItemId:'item-returned',quantity:'0.5'}])
  await seed(shop,'pos_supplier_delivery_records',[
    {id:'supplier-a',supplierName:'Supplier',invoiceNumber:'INV-SUP',amount:100,status:'active',receivedAt:date,supplierId:null},
    {id:'supplier-b',supplierName:'Supplier',invoiceNumber:'INV-SUP',amount:100,status:'cancelled',receivedAt:date,cancelReason:'Duplicate invoice'},
  ])
  await seed(shop,'pos_supplier_delivery_payments',[
    {id:'supplier-payment',deliveryRecordId:'supplier-a',amount:40,method:'Bank',paidAt:later,reference:'REF-123',payerName:'Payer',signatureDataUrl:'data:image/png;base64,fixture'},
    {id:'supplier-original',deliveryRecordId:'supplier-a',amount:30,method:'Cash',paidAt:date},
  ])
  await seed(shop,'pos_supplier_delivery_payment_reversals',[{id:'supplier-reversal',originalPaymentId:'supplier-original',reversedAt:later,reason:'Mistaken receipt'}])
  await seed(shop,'pos_expenses',[
    {id:'expense',title:'Delivery',category:'Stock Delivery',amount:10,method:'Cash',spentAt:date,createdAt:date,cancelledAt:later},
    {id:'income',title:'Income',category:'INCOME',amount:20,method:'Cash',spentAt:date,createdAt:date},
  ])
  const legacy=db.doc('users/demo-owner/payments/read-only-'+randomUUID()),legacyValue={amount:34500,status:'paid'};await legacy.set(legacyValue)
  const before=await snapshot(shop),all=await history.read(shop,{includeCustomerInvoices:'true',paged:'true',pageSize:'100'})
  const byId=(key)=>all.records.find((row)=>row.apiId===key)
  assert.equal(byId('partial').customerName,'Saved buyer');assert.equal(byId('partial').status,'Partial');assert.equal(byId('partial').remainingAmount,60)
  assert.equal(byId('returned').amount,50);assert.equal(byId('returned').remainingAmount,0);assert.equal(byId('returned').qty,0.5)
  assert.equal(byId('cod').remainingAmount,100,'Source worklist uses direct payments only; allocated COD receipt belongs to the dedicated COD workflow.')
  assert.equal(byId('retained').kind,'retained-income');assert.equal(byId('retained').amount,80);assert.equal(byId('retained').status,'Cancel')
  assert.equal(byId('pending').kind,'retained-income');assert.equal(byId('pending').amount,50);assert.equal(byId('pending-empty').status,'Return Pending')
  assert.equal(byId('supplier-a').activePaid,40);assert.equal(byId('supplier-a').remainingAmount,60);assert.equal(byId('supplier-a').allowedActions.cancelInvoice,false)
  assert.equal(byId('supplier-b').allowedActions.pay,false);assert.equal(byId('expense').kind,'expense');assert.equal(byId('expense').status,'Cancelled');assert.equal(byId('income').kind,'income')
  assert.equal(byId('nontracked').status,'Paid');assert.equal(byId('walkin'),undefined)
  assert.equal(new Set(all.records.map((row)=>row.recordKey)).size,all.records.length,'Duplicate displayed invoice numbers keep distinct record identities.')
  const customers=await history.read(shop,{includeCustomerInvoices:'true',paged:'true',mode:'Customer'})
  assert.ok(customers.records.every((row)=>['sale','retained-income'].includes(row.kind)&&row.customerId&&row.apiId!=='cod'))
  const partial=await history.read(shop,{includeCustomerInvoices:'true',paged:'true',status:'Partial'})
  assert.deepEqual(new Set(partial.records.map((row)=>row.apiId)),new Set(['partial','supplier-a']))
  const expense=await history.read(shop,{paged:'true',status:'Expense'});assert.equal(expense.records.length,0,'Cancelled expense is not a current Expense-status match.')
  const raw=await history.read(shop,{search:'no matching invoice',status:'Paid'})
  assert.ok(raw.records.length>0,'Non-paged source worklist intentionally does not apply presentation filters.')
  assert.equal(raw.records.some((row)=>row.apiId==='nontracked'),false)
  const dateRows=await history.read(shop,{includeCustomerInvoices:'true',paged:'true',from:'2026-10-10',to:'2026-10-10',pageSize:'100'})
  assert.ok(dateRows.records.some((row)=>row.apiId==='partial'),'Worklist date uses invoice creation, not latest collection.')
  assert.equal(dateRows.records.some((row)=>row.apiId==='boundary-before'),false);assert.ok(dateRows.records.some((row)=>row.apiId==='boundary-start'))
  assert.equal(dateRows.records.some((row)=>row.kind==='retained-income'),false,'Retained-income date follows original payment date.')
  const receipts=await history.read(shop,{view:'history',paged:'true',pageSize:'100'})
  assert.equal(receipts.records.some((row)=>row.paymentId==='p-nontracked'),false);assert.equal(receipts.records.some((row)=>row.paymentId==='allocated'),false)
  assert.equal(receipts.records.find((row)=>row.id==='r-retained').amount,20);assert.equal(receipts.records.find((row)=>row.id==='r-retained').status,'Refund')
  assert.equal(receipts.records.find((row)=>row.id==='supplier-reversal').reason,'Mistaken receipt')
  assert.equal(receipts.records.find((row)=>row.id==='supplier-payment').transactionId,'REF-123')
  assert.equal(receipts.records.filter((row)=>row.apiId==='expense').length,2)
  const onlyReversalDate=await history.read(shop,{view:'history',from:'2026-10-11',to:'2026-10-11'})
  assert.ok(onlyReversalDate.records.some((row)=>row.id==='supplier-original'),'Non-paged source includes original history when its reversal matches the date.')
  const filteredReversalDate=await history.read(shop,{view:'history',paged:'true',from:'2026-10-11',to:'2026-10-11'})
  assert.equal(filteredReversalDate.records.some((row)=>row.id==='supplier-original'),false)
  assert.ok(filteredReversalDate.records.some((row)=>row.id==='supplier-reversal'))
  assert.deepEqual(await snapshot(shop),before);assert.deepEqual((await legacy.get()).data(),legacyValue)
})

test('Payment paging summarizes the full selection and retains source supplier status, method, search and date filters across 151 invoices',async()=>{
  const shop='payment-pages-'+randomUUID(),records=Array.from({length:151},(_,i)=>({id:'delivery-'+String(i).padStart(3,'0'),supplierName:'Supplier '+i,invoiceNumber:'INVOICE-'+i,amount:100,status:'active',receivedAt:date}))
  await seed(shop,'pos_supplier_delivery_records',records)
  const first=await history.read(shop,{paged:'true',mode:'Supplier',pageSize:'50'})
  assert.equal(first.records.length,50);assert.equal(first.totalCount,151);assert.equal(first.pagination.hasMore,true)
  assert.deepEqual(first.summary,{amount:15100,count:151,outstanding:15100})
  const last=await history.read(shop,{paged:'true',mode:'Supplier',pageSize:'50',page:'4'})
  assert.equal(last.records.length,1);assert.equal(last.pagination.hasMore,false)
  const searching=await history.read(shop,{paged:'true',mode:'Supplier',search:'INVOICE-150',status:'Unpaid'})
  assert.equal(searching.records.length,1);assert.equal(searching.records[0].apiId,'delivery-150')
  const absentMethod=await history.read(shop,{paged:'true',mode:'Supplier',method:'Cash'});assert.equal(absentMethod.totalCount,0)
  const outside=await history.read(shop,{paged:'true',from:'2026-10-11',to:'2026-10-11'});assert.equal(outside.totalCount,0)
})
