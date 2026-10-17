import {createDirectPaymentsClient} from '../../BelleLocal POS app/src/features/firebase-direct/payments-client.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import {createCheckoutFrameRepository} from '../../BelleLocal POS app/src/features/firebase-direct/checkout-frame-repository.js'
import {directStockScope} from '../../BelleLocal POS app/src/features/firebase-direct/availability-model.js'
import {MAIN_OWNER_UID} from '../../BelleLocal POS app/src/features/firebase-direct/content-model.js'
import {createFrozenOrderRepository} from '../dashboard/shared/frozen-order-repository.js'
import {createDirectOnlineClient} from '../../BelleLocal POS app/src/features/firebase-direct/online-client.js'
import {createDirectOrdersClient} from '../../BelleLocal POS app/src/features/firebase-direct/orders-client.js'
const require=createRequire(new URL('../../BelleLocal POS app/package.json',import.meta.url)),sdk=require('firebase/firestore')
const{initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing')
if(process.env.DIRECT_FIRESTORE_EMULATOR!=='127.0.0.1:8088')throw Error('Use the isolated direct emulator.')
const env=await initializeTestEnvironment({projectId:'demo-belle-direct-payments',firestore:{host:'127.0.0.1',port:8088,rules:await readFile(new URL('../../BelleLocal POS app/config/firebase/firestore.direct.rules',import.meta.url),'utf8')}})
test.after(()=>env.cleanup())
const root='onlineShopV2/belle-online',scope=await directStockScope('pos','v'),ref=(db,table,id)=>sdk.doc(db,`${root}/${table}/${id}`),owner=()=>env.authenticatedContext(MAIN_OWNER_UID).firestore(),auth={currentUser:{uid:MAIN_OWNER_UID,displayName:'Belle Owner'}}
async function fixture({lines=1,price=34500}={}){
  await env.clearFirestore()
  const db=owner(),choices=Array.from({length:lines},(_,index)=>`choice-${index}`)
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(),batch=sdk.writeBatch(db)
    batch.set(ref(db,'direct_runtime','main'),{stock_authority:'ledger-v2',online_orders_enabled:true,pos_orders_enabled:true,pos_payments_enabled:true,backend_writers_stopped:true,original_writers_stopped:true,direct_guest_protocol:'fifo-frame-v1',guest_checkout_enabled:true})
    batch.set(ref(db,'pos_settings','main'),{paymentMethods:[{name:'Bank',active:true,type:'bank'}]})
    batch.set(ref(db,'pos_products','pos'),{id:'pos',name:'Elegence',trackingMode:'NONE',price,cost:12000,units:[{id:'product-piece',unitId:'piece',isBase:true,conversionFactor:'1',canSell:true}],variants:[{id:'v',name:'Brown / 1',price,cost:12000}]})
    batch.set(ref(db,'pos_units','piece'),{id:'piece',name:'Piece',symbol:'pcs',precision:0,isActive:true})
    batch.set(ref(db,'stock_balances',scope),{productId:'pos',variantId:'v',onHand:String(lines+1),reserved:'0',version:1})
    batch.set(ref(db,'stock_batches','batch'),{id:'batch',productId:'pos',variantId:'v',scopeKey:scope,quantity:lines+1,reservedQuantity:0,baseQuantity:String(lines+1),reservedBaseQuantity:'0',physicalBaseQuantity:String(lines+1),heldBaseQuantity:'0',consumedBaseQuantity:'0',unitCost:12000,receivedAt:'2026-07-23'})
    for(const id of choices)batch.set(ref(db,'stock_bindings',id),{id,public_variant_id:id,public_product_id:'post',pos_product_id:'pos',pos_variant_id:'v',scope_key:scope})
    batch.set(ref(db,'products','post'),{id:'post',name:'Elegence',status:'published',variants:choices.map(id=>({id,color:'Brown',size:'1',active:true}))})
    batch.set(sdk.doc(db,`users/${MAIN_OWNER_UID}/orders/original`),{total:34500,paymentStatus:'unpaid'})
    await batch.commit()
  })
  await createCheckoutFrameRepository({db,auth,sdk}).publish({enable:true})
  const guestDb=env.authenticatedContext('buyer').firestore(),user={uid:'buyer',isAnonymous:true}
  await createFrozenOrderRepository({db:guestDb,auth:{currentUser:user},sdk,authenticate:async()=>user}).submit({request_key:'request',tracking_token:'a'.repeat(64),customer:{name:'Yu',phone:'09999999999',city:'Yangon',address:'Private address'},items:choices.map(variant_id=>({variant_id,quantity:1}))})
  const online=createDirectOnlineClient({db,auth,sdk})
  await online('admin/records/orders')
  await online('admin/orders/request/transition',{status:'confirmed'})
  assert.deepEqual(await online('admin/orders/request/handover-options'),{items:[]})
  return {db,online,orders:createDirectOrdersClient({db,auth,sdk})}
}
async function invoice(){
  const state=await fixture()
  const result=await state.orders('admin/orders/request/pos-order',{paymentMode:'UNPAID'},{requestKey:'unpaid-invoice-request-001'})
  return {...state,id:result.order.id,payments:createDirectPaymentsClient({db:state.db,auth,sdk})}
}
const path=id=>`admin/pos/orders/${id}/payments`
test('direct source collection retains deposit/final balance, request replay, credit-settlement validation, receipt/history and original immutability',async()=>{
  const{db,id,payments,orders}=await invoice(),options={requestKey:'direct-payment-request-001'},body={scope:'advanced-payment',method:'Cash',amount:10000,paidAt:'2026-07-23T10:00:00.000Z'}
  const received=await payments(path(id),body,options)
  assert.equal(received.order.paymentStatus,'partial');assert.equal(received.payment.amount,10000)
  assert.deepEqual(await payments(path(id),body,options),received)
  await assert.rejects(payments(path(id),{...body,amount:10001},options),{status:409})
  await assert.rejects(payments(path(id),{method:'Bank',scope:'credit-settlement',amount:10000},{requestKey:'direct-payment-request-002'}),/must equal/)
  await assert.rejects(payments(path(id),{method:'Bank',amount:24501},{requestKey:'direct-payment-request-003'}),/exceed/)
  const final=await payments(path(id),{method:'Bank',transactionId:'TRANSACTION',scope:'credit-settlement'},{requestKey:'direct-payment-request-004'})
  assert.equal(final.payment.amount,24500);assert.equal(final.order.paymentStatus,'paid')
  const head=(await sdk.getDoc(ref(db,'pos_payment_heads',id))).data()
  assert.equal(head.paid,34500);assert.equal(head.version,2)
  const detail=await orders(`admin/pos/orders/${id}`)
  assert.equal(detail.order.payments.length,2);assert.equal(detail.order.paymentStatus,'paid')
  const history=await payments('admin/pos/payment-history?view=history&from=2026-07-23&to=2026-07-23')
  assert.equal(history.records.length,1);assert.equal(history.records[0].amount,10000)
  assert.equal((await payments('admin/pos/payments')).payments.length,2)
  assert.deepEqual((await sdk.getDoc(sdk.doc(db,`users/${MAIN_OWNER_UID}/orders/original`))).data(),{total:34500,paymentStatus:'unpaid'})
  await assertFails(sdk.updateDoc(ref(db,'pos_payments',received.payment.id),{amount:1}))
  await assertFails(sdk.getDoc(ref(env.unauthenticatedContext().firestore(),'pos_payment_heads',id)))
})
test('competing final receipts cannot overpay and a lost committed response retries without another receipt',async()=>{
  let state=await invoice()
  const results=await Promise.allSettled([state.payments(path(state.id),{method:'Cash',amount:34500},{requestKey:'competing-payment-key-001'}),state.payments(path(state.id),{method:'Bank',amount:34500},{requestKey:'competing-payment-key-002'})])
  assert.equal(results.filter(row=>row.status==='fulfilled').length,1)
  assert.equal(results.filter(row=>row.status==='rejected').length,1)
  assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/pos_payments`))).size,1)
  assert.equal((await sdk.getDoc(ref(state.db,'pos_payment_heads',state.id))).data().paid,34500)
  state=await invoice();let lose=true
  const intercepted={...sdk,async runTransaction(...args){const result=await sdk.runTransaction(...args);if(lose&&(await sdk.getDocs(sdk.collection(state.db,`${root}/pos_payment_events`))).size){lose=false;throw Error('Payment response lost')}return result}}
  const payments=createDirectPaymentsClient({db:state.db,auth,sdk:intercepted}),body={method:'Cash',amount:5000},options={requestKey:'uncertain-payment-key-001'}
  await assert.rejects(payments(path(state.id),body,options),/response lost/)
  const replay=await payments(path(state.id),body,options)
  assert.equal(replay.payment.amount,5000);assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/pos_payments`))).size,1)
})
test('Rules reject bypassed overpayment, removed witness and nonfinancial invoice edits with complete rollback',async()=>{
  for(const attack of ['amount','witness','order']){
    const state=await invoice()
    const malicious={...sdk,runTransaction(db,action){return sdk.runTransaction(db,tx=>action(new Proxy(tx,{get(target,name){
      if(name==='set')return(reference,value)=>{
        if(attack==='witness'&&reference.path.includes('/pos_payment_events/'))return target
        const changed=structuredClone(value)
        if(attack==='amount'&&reference.path.includes('/pos_payments/'))changed.amount=40000
        if(attack==='order'&&reference.path.includes('/pos_orders/'))changed.total=1
        return target.set(reference,changed)
      }
      const value=target[name];return typeof value==='function'?value.bind(target):value
    }})))}}
    await assert.rejects(createDirectPaymentsClient({db:state.db,auth,sdk:malicious})(path(state.id),{method:'Cash',amount:5000},{requestKey:'tampered-payment-key-001'}),error=>error.code==='permission-denied')
    assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/pos_payments`))).size,0)
    assert.equal((await sdk.getDoc(ref(state.db,'pos_orders',state.id))).data().paymentStatus,'unpaid')
    assert.equal((await sdk.getDoc(ref(state.db,'stock_balances',scope))).data().reserved,'1')
  }
})
test('source methods, reference uniqueness, disabled capability and JSON settings retain their contracts',async()=>{
  const state=await invoice()
  await assert.rejects(state.payments(path(state.id),{method:'COD',amount:1000},{requestKey:'method-payment-key-001'}),error=>error.code==='PAYMENT_METHOD_CHANGED')
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore()
    await sdk.updateDoc(ref(db,'pos_settings','main'),{paymentMethods:JSON.stringify([{name:'Bank',type:'bank',active:true}])})
    await sdk.setDoc(ref(db,'pos_payments','prior-reference'),{id:'prior-reference',orderId:'other',method:'Bank',transactionId:'SAME',billNumber:'BILL',amount:1000})
  })
  await assert.rejects(state.payments(path(state.id),{method:'Bank',transactionId:'SAME',amount:1000},{requestKey:'reference-payment-key-001'}),/reference already exists/)
  await state.payments(path(state.id),{method:'Bank',transactionId:'SAME',billNumber:'DIFFERENT',amount:1000},{requestKey:'reference-payment-key-002'})
  await env.withSecurityRulesDisabled(async context=>{await sdk.updateDoc(ref(context.firestore(),'direct_runtime','main'),{pos_payments_enabled:false})})
  await assert.rejects(state.payments(path(state.id),{method:'Cash',amount:1000},{requestKey:'disabled-payment-key-001'}),{status:409})
})
test('existing new-POS receipts and seeded returns retain source payable balance; reserved stock is unchanged and source drift rejects',async()=>{
  const state=await invoice(),item=(await sdk.getDoc(ref(state.db,'pos_orders',state.id))).data().items[0]
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(),batch=sdk.writeBatch(db)
    batch.set(ref(db,'pos_customer_returns','returned-half'),{id:'returned-half',orderId:state.id,orderItemId:item.id,quantity:0.5,createdAt:'2026-07-23T00:00:00.000Z'})
    batch.set(ref(db,'pos_payments','old-deposit'),{id:'old-deposit',orderId:state.id,shopId:'belle-online',type:'payment',scope:'order-payment',method:'Cash',amount:3000,paidAt:'2026-07-23T00:00:00.000Z',createdAt:'2026-07-23T00:00:00.000Z'})
    await batch.commit()
  })
  await assert.rejects(state.payments(path(state.id),{method:'Cash',amount:14251},{requestKey:'return-balance-key-001'}),/exceed/)
  const result=await state.payments(path(state.id),{method:'Cash',amount:14250},{requestKey:'return-balance-key-002'})
  assert.equal(result.order.paymentStatus,'paid')
  const head=(await sdk.getDoc(ref(state.db,'pos_payment_heads',state.id))).data()
  assert.equal(head.payable,17250);assert.equal(head.paid,17250)
  assert.equal((await sdk.getDoc(ref(state.db,'stock_balances',scope))).data().reserved,'1')
  await env.withSecurityRulesDisabled(async context=>{await sdk.setDoc(ref(context.firestore(),'pos_payments','refund-fixture'),{id:'refund-fixture',orderId:state.id,amount:-1000,paidAt:new Date().toISOString()})})
  await assert.rejects(state.payments(path(state.id),{method:'Cash',amount:1000},{requestKey:'source-drift-key-001'}),{status:409})
})
test('cross-invoice competing duplicate references share the fence and reject the second receipt without partial order updates',async()=>{
  const state=await invoice(),guestDb=env.authenticatedContext('second-buyer').firestore(),user={uid:'second-buyer',isAnonymous:true}
  await createFrozenOrderRepository({db:guestDb,auth:{currentUser:user},sdk,authenticate:async()=>user}).submit({request_key:'second-request',tracking_token:'b'.repeat(64),customer:{name:'Other',phone:'09999999998',city:'Yangon',address:'Other address'},items:[{variant_id:'choice-0',quantity:1}]})
  await state.online('admin/records/orders');await state.online('admin/orders/second-request/transition',{status:'confirmed'})
  const second=await state.orders('admin/orders/second-request/pos-order',{paymentMode:'UNPAID'},{requestKey:'second-invoice-request-001'})
  const body={method:'Bank',transactionId:'SAME-REFERENCE',amount:1000}
  const result=await Promise.allSettled([state.payments(path(state.id),body,{requestKey:'cross-reference-key-001'}),state.payments(path(second.order.id),body,{requestKey:'cross-reference-key-002'})])
  assert.equal(result.filter(row=>row.status==='fulfilled').length,1)
  assert.equal(result.filter(row=>row.status==='rejected'&&/reference already exists/.test(row.reason.message)).length,1)
  assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/pos_payments`))).size,1)
  assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/pos_payment_events`))).size,1)
})
