import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import {createDirectCodWriter} from '../../BelleLocal POS app/src/features/firebase-direct/cod-writer.js'
import {createDirectPaymentsClient} from '../../BelleLocal POS app/src/features/firebase-direct/payments-client.js'
import {MAIN_OWNER_UID} from '../../BelleLocal POS app/src/features/firebase-direct/content-model.js'
const require=createRequire(new URL('../../BelleLocal POS app/package.json',import.meta.url)),sdk=require('firebase/firestore')
const{initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing')
if(process.env.DIRECT_FIRESTORE_EMULATOR!=='127.0.0.1:8088')throw Error('Use the isolated direct emulator.')
const env=await initializeTestEnvironment({projectId:'demo-belle-direct-cod-writer',firestore:{host:'127.0.0.1',port:8088,rules:await readFile(new URL('../../BelleLocal POS app/config/firebase/firestore.direct.rules',import.meta.url),'utf8')}})
test.after(()=>env.cleanup())
const root='onlineShopV2/belle-online',ref=(db,table,id='main')=>sdk.doc(db,`${root}/${table}/${id}`),auth={currentUser:{uid:MAIN_OWNER_UID,displayName:'Belle Owner'}},owner=()=>env.authenticatedContext(MAIN_OWNER_UID).firestore()
async function fixture(count=2){
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();let batch=sdk.writeBatch(db),size=0
    const save=async(table,id,value)=>{batch.set(ref(db,table,id),value);if(++size===400){await batch.commit();batch=sdk.writeBatch(db);size=0}}
    await save('direct_runtime','main',{stock_authority:'ledger-v2',pos_cod_enabled:true,pos_payments_enabled:true,pos_orders_enabled:true,pos_operations_enabled:true,pos_deliveries_enabled:true,online_orders_enabled:true,legacy_continuation_enabled:true,original_policy_version:'immutable-history-v1',original_records_immutable:true,backend_writers_stopped:true,original_writers_stopped:true})
    await save('direct_stock_meta','main',{version:1})
    await save('pos_settings','main',{paymentMethods:[]})
    await save('public_checkout_book','main',{schema:'fifo-frame-v1',frame_id:'a'.repeat(64),source_revision:1,content_revision:0,quotes:{},cursors:{},delivery_fee:0,checkout_enabled:false,version:1,last_request_id:null})
    await save('stock_balances','stock',{onHand:'2',reserved:'0',version:1})
    for(let index=0;index<count;index++){
      const id=`invoice-${index}`
      await save('pos_orders',id,{id,shopId:'belle-online',orderNumber:`INV-${index}`,total:100,subtotal:100,discount:0,items:[],saleType:'ONLINE',collectionArrangement:'COD',fulfillmentStatus:'completed',cancellationState:null,paymentStatus:'unpaid',codCollectAmount:100,createdAt:'2026-07-23T00:00:00.000Z',updatedAt:'2026-07-23T00:00:00.000Z',customerSnapshot:{name:'Customer',phone:'09999999999'}})
      await save('pos_delivery_memberships',id,{orderId:id,handoverId:'delivery'})
    }
    if(size)await batch.commit()
    await sdk.setDoc(sdk.doc(db,`users/${MAIN_OWNER_UID}/orders/original`),{total:34500,paymentStatus:'unpaid'})
  })
  const db=owner(),writer=createDirectCodWriter({db,auth,sdk}),reader=createDirectPaymentsClient({db,auth,sdk})
  return{db,writer,reader}
}
const body=(count=2)=>({receivingMethod:'Cash',statementNumber:'123456',transactionId:'654321',paymentDate:'2026-07-23',amount:count*100,allocations:Array.from({length:count},(_,index)=>({orderId:`invoice-${index}`,expectedBalance:100}))})
const rows=async(db,table)=>(await sdk.getDocs(sdk.collection(db,`${root}/${table}`))).docs.map(row=>row.data())
test('500-invoice source receipt/reversal commits through actual SDK/business Rules with immutable originals, versioned heads and unchanged physical stock',async()=>{
  const{db,writer,reader}=await fixture(500),received=await writer.receive(body(500),'direct-cod-receive-key-001')
  assert.equal(received.settlement.allocations.length,500);assert.equal(received.settlement.amount,50000)
  assert.equal((await rows(db,'pos_payments')).length,500);assert.equal((await rows(db,'pos_cod_payment_events')).length,500)
  assert.equal((await sdk.getDoc(ref(db,'pos_payment_heads','invoice-0'))).data().paid,100)
  assert.equal((await reader('admin/pos/payments/cod-pending')).pagination.total,0)
  assert.equal((await writer.receive(body(500),'direct-cod-receive-key-001')).replayed,true)
  const originals=await rows(db,'pos_payments')
  await writer.reverse(received.settlement.id,{reason:'Wrong statement'},'direct-cod-reverse-key-001')
  assert.equal((await writer.reverse(received.settlement.id,{reason:'Wrong statement'},'direct-cod-reverse-key-001')).replayed,true)
  const payments=await rows(db,'pos_payments')
  assert.equal(payments.length,1000);assert.equal(payments.reduce((sum,row)=>sum+row.amount,0),0)
  for(const payment of originals)assert.deepEqual(payments.find(row=>row.id===payment.id),payment)
  assert.equal((await sdk.getDoc(ref(db,'pos_payment_heads','invoice-0'))).data().paid,0)
  assert.equal((await sdk.getDoc(ref(db,'pos_payment_heads','invoice-0'))).data().version,2)
  assert.equal((await reader('admin/pos/payments/cod-pending')).pagination.total,500)
  assert.equal((await sdk.getDoc(ref(db,'direct_stock_meta'))).data().version,3)
  assert.equal((await sdk.getDoc(ref(db,'public_checkout_book'))).data().source_revision,3)
  assert.deepEqual((await sdk.getDoc(ref(db,'stock_balances','stock'))).data(),{onHand:'2',reserved:'0',version:1})
  assert.deepEqual((await sdk.getDoc(sdk.doc(db,`users/${MAIN_OWNER_UID}/orders/original`))).data(),{total:34500,paymentStatus:'unpaid'})
  await assertFails(sdk.getDocs(sdk.collection(env.unauthenticatedContext().firestore(),`${root}/pos_cod_settlements`)))
  await assertFails(sdk.updateDoc(ref(db,'pos_payments',originals[0].id),{amount:1}))
})
test('a lost committed COD response retries the same source key without another receipt, payment or head advance',async()=>{
  const{db}=await fixture(1);let lose=true
  const intercepted={...sdk,async runTransaction(...args){const result=await sdk.runTransaction(...args);if(lose&&result?.settlement&&(await sdk.getDoc(ref(db,'pos_cod_commit'))).data()?.settlementId===result.settlement.id){lose=false;throw Error('COD response lost')}return result}}
  const writer=createDirectCodWriter({db,auth,sdk:intercepted})
  await assert.rejects(writer.receive(body(1),'uncertain-cod-receive-001'),/response lost/)
  assert.equal((await writer.receive(body(1),'uncertain-cod-receive-001')).replayed,true)
  assert.equal((await rows(db,'pos_cod_settlements')).length,1);assert.equal((await rows(db,'pos_payments')).length,1)
  assert.equal((await sdk.getDoc(ref(db,'pos_payment_heads','invoice-0'))).data().version,1)
})
test('overlapping source balances/references compete on the common fence with only one committed receipt',async()=>{
  const{db,writer}=await fixture(2),result=await Promise.allSettled([writer.receive(body(2),'competing-cod-receive-001'),writer.receive(body(1),'competing-cod-receive-002')])
  assert.equal(result.filter(row=>row.status==='fulfilled').length,1)
  assert.equal(result.filter(row=>row.status==='rejected').length,1)
  assert.equal((await rows(db,'pos_cod_settlements')).length,1)
  assert.equal((await sdk.getDoc(ref(db,'direct_stock_meta'))).data().version,2)
})
test('altered native receipt amount rolls the complete financial transaction back while provisional evidence stays inert',async()=>{
  const{db}=await fixture(2),malicious={...sdk,runTransaction(db,action){return sdk.runTransaction(db,tx=>action(new Proxy(tx,{get(target,name){if(name==='set')return(reference,value)=>target.set(reference,reference.path.includes('/pos_payments/')?{...value,amount:999}:value);const value=target[name];return typeof value==='function'?value.bind(target):value}})))}}
  await assert.rejects(createDirectCodWriter({db,auth,sdk:malicious}).receive(body(2),'altered-cod-receive-001'),error=>error.code==='permission-denied')
  assert.equal((await rows(db,'pos_payments')).length,0);assert.equal((await rows(db,'pos_cod_settlements')).length,0)
  assert.equal((await rows(db,'pos_payment_heads')).length,0);assert.equal((await sdk.getDoc(ref(db,'direct_stock_meta'))).data().version,1)
  assert.equal((await sdk.getDoc(ref(db,'pos_orders','invoice-0'))).data().paymentStatus,'unpaid')
})
