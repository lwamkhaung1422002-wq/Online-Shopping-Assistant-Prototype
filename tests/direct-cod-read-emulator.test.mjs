import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import {createDirectPaymentsClient} from '../../BelleLocal POS app/src/features/firebase-direct/payments-client.js'
import {MAIN_OWNER_UID} from '../../BelleLocal POS app/src/features/firebase-direct/content-model.js'
import {createCodMutationPlanner} from '../../BelleLocal POS app/src/features/firebase-direct/cod-mutation-plan.js'
const require=createRequire(new URL('../../BelleLocal POS app/package.json',import.meta.url)),sdk=require('firebase/firestore')
const{initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing')
if(process.env.DIRECT_FIRESTORE_EMULATOR!=='127.0.0.1:8088')throw Error('Use the isolated direct emulator.')
const env=await initializeTestEnvironment({projectId:'demo-belle-direct-cod-read',firestore:{host:'127.0.0.1',port:8088,rules:await readFile(new URL('../../BelleLocal POS app/config/firebase/firestore.direct.rules',import.meta.url),'utf8')}})
test.after(()=>env.cleanup())
const root='onlineShopV2/belle-online',ref=(db,table,id)=>sdk.doc(db,`${root}/${table}/${id}`),owner=()=>env.authenticatedContext(MAIN_OWNER_UID).firestore(),auth={currentUser:{uid:MAIN_OWNER_UID}}
const invoice=(id,extra={})=>({id,orderNumber:`INV-${id}`,saleType:'ONLINE',collectionArrangement:'COD',fulfillmentStatus:'completed',cancellationState:null,customerSnapshot:{name:'Yu',phone:'09942988167'},createdAt:'2026-07-23T10:00:00.000Z',total:34500,subtotal:34500,discount:0,items:[{id:`item-${id}`,quantity:1,baseQuantity:'1',lineTotal:34500}],...extra})
async function seed(count=0){
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();let batch=sdk.writeBatch(db),size=0
    const save=async(table,id,value)=>{batch.set(ref(db,table,id),value);if(++size===400){await batch.commit();batch=sdk.writeBatch(db);size=0}}
    await save('direct_runtime','main',{backend_writers_stopped:true,original_writers_stopped:true})
    for(let i=0;i<count;i++){
      const id=`invoice-${String(i).padStart(3,'0')}`
      await save('pos_orders',id,invoice(id))
      await save('pos_delivery_memberships',id,{orderId:id,handoverId:'delivery'})
    }
    if(size)await batch.commit()
  })
}
test('mounted COD pending retains return-valued balances, signed allocated receipts, eligibility and search without writes',async()=>{
  await seed()
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(),batch=sdk.writeBatch(db)
    for(const[id,extra,member]of[['due',{},true],['paid',{},true],['cancelled',{cancellationState:'pending'},true],['undelivered',{fulfillmentStatus:'pending'},true],['not-cod',{collectionArrangement:'CREDIT'},true],['not-member',{},false]]){
      batch.set(ref(db,'pos_orders',id),invoice(id,extra))
      if(member)batch.set(ref(db,'pos_delivery_memberships',id),{orderId:id})
    }
    batch.set(ref(db,'pos_customer_returns','return'),{id:'return',orderItemId:'item-due',quantity:0.5})
    batch.set(ref(db,'pos_payments','deposit'),{id:'deposit',orderId:'due',amount:3000})
    batch.set(ref(db,'pos_payments','allocated'),{id:'allocated',orderId:null,orderIds:JSON.stringify(['due']),allocations:JSON.stringify([{orderId:'due',amount:1000}]),amount:1000})
    batch.set(ref(db,'pos_payments','allocated-void'),{id:'allocated-void',orderId:null,orderIds:JSON.stringify(['due']),allocations:JSON.stringify([{orderId:'due',amount:1000}]),scope:'void',amount:-1000})
    batch.set(ref(db,'pos_payments','full'),{id:'full',orderId:'paid',amount:34500})
    batch.set(sdk.doc(db,`users/${MAIN_OWNER_UID}/orders/original`),{total:34500,paymentStatus:'unpaid'})
    await batch.commit()
  })
  const db=owner(),client=createDirectPaymentsClient({db,auth,sdk})
  const result=await client('admin/pos/payments/cod-pending?search=094298')
  assert.equal(result.pagination.total,0)
  const found=await client('admin/pos/payments/cod-pending?search=Yu')
  assert.equal(found.pagination.total,1);assert.equal(found.invoices[0].id,'due')
  assert.equal(found.invoices[0].total,17250);assert.equal(found.invoices[0].remainingAmount,14250)
  assert.equal((await sdk.getDoc(ref(db,'pos_orders','due'))).data().total,34500)
  assert.deepEqual((await sdk.getDoc(sdk.doc(db,`users/${MAIN_OWNER_UID}/orders/original`))).data(),{total:34500,paymentStatus:'unpaid'})
  await assertFails(sdk.getDocs(sdk.collection(env.unauthenticatedContext().firestore(),`${root}/pos_orders`)))
  await assert.rejects(createDirectPaymentsClient({db,auth:{currentUser:{uid:'outsider'}},sdk})('admin/pos/payments/cod-pending'),{status:403})
})
test('COD reader preserves all 500 invoices, full paging and source tie ordering',async()=>{
  await seed(500)
  const client=createDirectPaymentsClient({db:owner(),auth,sdk}),result=await client('admin/pos/payments/cod-pending?page=5&pageSize=100')
  assert.deepEqual(result.pagination,{page:5,pageSize:100,total:500,hasMore:false})
  assert.equal(result.invoices.length,100);assert.equal(result.invoices[0].id,'invoice-099');assert.equal(result.invoices.at(-1).id,'invoice-000')
  const db=owner(),planner=createCodMutationPlanner({db,auth,sdk})
  const plan=await planner.receive({receivingMethod:'Cash',statementNumber:'123456',transactionId:'654321',paymentDate:'2026-07-23',amount:17250000,allocations:Array.from({length:500},(_,index)=>({orderId:`invoice-${String(index).padStart(3,'0')}`,expectedBalance:34500}))},'prepared-cod-request-001')
  assert.equal(plan.writes.length,2003);assert.equal(plan.result.settlement.allocations.length,500)
  assert.equal(plan.result.settlement.amount,17250000);assert.equal(plan.writesByteLength<1000000,true)
  assert.equal(plan.financialEntries.length,500)
  assert.equal(plan.financialEntries[0].paidBefore,0);assert.equal(plan.financialEntries[0].paidAfter,34500)
  assert.equal(plan.financialEntries[0].remainingAfter,0);assert.equal(plan.financialEntries[0].version,1)
  assert.equal(plan.writes.filter(row=>row.path.includes('/pos_payments/')).length,500)
  assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/pos_payments`))).size,0)
  assert.equal((await sdk.getDoc(ref(db,'pos_orders','invoice-000'))).data().total,34500)
})
test('saved receipt keeps original/correction evidence; no write route is enabled by the read conversion',async()=>{
  await seed()
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(),batch=sdk.writeBatch(db)
    batch.set(ref(db,'pos_orders','receipt-order'),invoice('receipt-order'))
    batch.set(ref(db,'pos_cod_settlements','settlement'),{id:'settlement',amount:34500,statementNumber:'123456',transactionId:'654321',reversedAt:'2026-07-24T00:00:00.000Z'})
    batch.set(ref(db,'pos_cod_settlement_allocations','allocation'),{id:'allocation',settlementId:'settlement',orderId:'receipt-order',paymentId:'original',correctionPaymentId:'correction',amount:34500})
    batch.set(ref(db,'pos_payments','original'),{id:'original',orderId:'receipt-order',amount:34500,type:'payment',scope:'cod-receipt'})
    batch.set(ref(db,'pos_payments','correction'),{id:'correction',orderId:'receipt-order',amount:-34500,type:'cod-settlement-void',originalPaymentId:'original'})
    await batch.commit()
  })
  const db=owner(),client=createDirectPaymentsClient({db,auth,sdk}),result=await client('admin/pos/payments/cod-settlements/settlement')
  assert.equal(result.settlement.allocations[0].order.orderNumber,'INV-receipt-order')
  assert.equal(result.settlement.allocations[0].payment.amount,34500)
  assert.equal(result.settlement.allocations[0].correctionPayment.amount,-34500)
  // Already reversed source state preserves the exact reference conflict.
  await assert.rejects(createCodMutationPlanner({db,auth,sdk}).reverse('settlement',{reason:'Statement correction'},'prepared-reversal-key-001'),error=>error.code==='SETTLEMENT_CHANGED')
  await assert.rejects(client('admin/pos/payments/cod-settlements/missing'),{status:404})
  await assert.rejects(client('admin/pos/payments/cod-settlements/receive',{amount:34500},{requestKey:'same-request-key-001'}),{status:501})
  await assert.rejects(client('admin/pos/payments/cod-settlements/settlement/void',{reason:'Correction'},{requestKey:'same-request-key-001'}),{status:501})
  assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/pos_payments`))).size,2)
  await assertFails(sdk.getDoc(ref(env.unauthenticatedContext().firestore(),'pos_cod_settlements','settlement')))
})
test('COD financial plans retain deposits/versions, reject a stale head and derive a reasoned negative correction without effects',async()=>{
  await seed(1)
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(),batch=sdk.writeBatch(db)
    batch.set(ref(db,'pos_payments','deposit'),{id:'deposit',orderId:'invoice-000',amount:3000,createdAt:'2026-07-23T00:00:00.000Z'})
    batch.set(ref(db,'pos_payment_baselines','invoice-000'),{orderId:'invoice-000',paid:0,payable:34500,source_hash:'a'.repeat(64)})
    batch.set(ref(db,'pos_payment_heads','invoice-000'),{orderId:'invoice-000',paid:3000,payable:34500,version:1,lastPaymentId:'deposit'})
    await batch.commit()
  })
  const db=owner(),planner=createCodMutationPlanner({db,auth,sdk}),body={receivingMethod:'Cash',statementNumber:'123456',transactionId:'654321',paymentDate:'2026-07-23',amount:31500,allocations:[{orderId:'invoice-000',expectedBalance:31500}]}
  const received=await planner.receive(body,'prepared-financial-key-001'),fact=received.financialEntries[0]
  assert.equal(fact.paidBefore,3000);assert.equal(fact.paidAfter,34500);assert.equal(fact.version,2)
  assert.equal(fact.lastPaymentIdBefore,'deposit');assert.equal(fact.amount,31500)
  await env.withSecurityRulesDisabled(context=>sdk.updateDoc(ref(context.firestore(),'pos_payment_heads','invoice-000'),{paid:3001}))
  await assert.rejects(planner.receive(body,'prepared-financial-key-002'),/head requires reconciliation/)
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(),batch=sdk.writeBatch(db),date='2026-07-24T00:00:00.000Z'
    batch.set(ref(db,'pos_cod_settlements','receipt'),{id:'receipt',receivingMethod:'Cash',amount:31500,createdAt:date,reversedAt:null})
    batch.set(ref(db,'pos_cod_settlement_allocations','selected'),{id:'selected',settlementId:'receipt',orderId:'invoice-000',paymentId:'cod-original',amount:31500,correctionPaymentId:null})
    batch.set(ref(db,'pos_payments','cod-original'),{id:'cod-original',orderId:'invoice-000',amount:31500,type:'payment',scope:'cod-receipt',createdAt:date})
    batch.update(ref(db,'pos_payment_heads','invoice-000'),{paid:34500,version:2,lastPaymentId:'cod-original'})
    await batch.commit()
  })
  const reversed=await planner.reverse('receipt',{reason:'Wrong statement'},'prepared-financial-void-001'),correction=reversed.financialEntries[0]
  assert.equal(correction.paidBefore,34500);assert.equal(correction.paidAfter,3000);assert.equal(correction.remainingAfter,31500)
  assert.equal(correction.version,3);assert.equal(correction.originalPaymentId,'cod-original');assert.equal(correction.amount,-31500)
  assert.equal(reversed.writes.length,5)
  const plannedPayment=reversed.writes.find(row=>row.path.includes('/pos_payments/')).data
  assert.equal(plannedPayment.reason,'Wrong statement');assert.equal(plannedPayment.originalPaymentId,'cod-original')
  assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/pos_payments`))).size,2)
  assert.equal((await sdk.getDoc(ref(db,'pos_payment_heads','invoice-000'))).data().version,2)
})
