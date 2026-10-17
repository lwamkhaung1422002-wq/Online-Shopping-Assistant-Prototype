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
const env=await initializeTestEnvironment({projectId:'demo-belle-direct-invoice',firestore:{host:'127.0.0.1',port:8088,rules:await readFile(new URL('../../BelleLocal POS app/config/firebase/firestore.direct.rules',import.meta.url),'utf8')}})
test.after(()=>env.cleanup())
const root='onlineShopV2/belle-online',scope=await directStockScope('pos','v'),ref=(db,table,id)=>sdk.doc(db,`${root}/${table}/${id}`),owner=()=>env.authenticatedContext(MAIN_OWNER_UID).firestore(),auth={currentUser:{uid:MAIN_OWNER_UID,displayName:'Belle Owner'}}
async function fixture({lines=1,price=34500}={}){
  await env.clearFirestore()
  const db=owner(),choices=Array.from({length:lines},(_,index)=>`choice-${index}`)
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(),batch=sdk.writeBatch(db)
    batch.set(ref(db,'direct_runtime','main'),{stock_authority:'ledger-v2',online_orders_enabled:true,pos_orders_enabled:true,backend_writers_stopped:true,original_writers_stopped:true,direct_guest_protocol:'fifo-frame-v1',guest_checkout_enabled:true})
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
test('SDK customer order -> accept -> unpaid POS invoice moves the exact frozen hold once and projects the reference receipt',async()=>{
  const{db,orders}=await fixture(),before=(await sdk.getDoc(ref(db,'stock_balances',scope))).data(),batchBefore=(await sdk.getDoc(ref(db,'stock_batches','batch'))).data()
  const result=await orders('admin/orders/request/pos-order',{paymentMode:'UNPAID'},{requestKey:'invoice-request-key-001'})
  assert.equal(result.order.total,34500);assert.equal(result.order.paymentStatus,'unpaid');assert.equal(result.order.fulfillmentStatus,'reserved')
  assert.equal(result.order.items[0].unitCost,12000);assert.equal(result.order.items[0].allocations[0].baseQuantity,'1')
  assert.equal(result.receipt.customer.name,'Yu');assert.equal(result.receipt.saleType,'ONLINE')
  const after=(await sdk.getDoc(ref(db,'stock_balances',scope))).data()
  assert.equal(after.onHand,before.onHand);assert.equal(after.reserved,before.reserved);assert.deepEqual((await sdk.getDoc(ref(db,'stock_batches','batch'))).data(),batchBefore)
  const holds=(await sdk.getDocs(sdk.collection(db,`${root}/stock_reservations`))).docs.map(row=>row.data())
  assert.equal(holds.filter(row=>row.status==='ACTIVE').length,1);assert.equal(holds.find(row=>row.status==='ACTIVE').sourceType,'PosOrder');assert.equal(holds.find(row=>row.sourceType==='OnlineOrder').status,'TRANSFERRED')
  const replay=await orders('admin/orders/request/pos-order',{paymentMode:'UNPAID'},{requestKey:'invoice-request-key-001'})
  const otherKey=await orders('admin/orders/request/pos-order',{paymentMode:'UNPAID'},{requestKey:'invoice-request-key-002'})
  assert.equal(replay.order.id,result.order.id);assert.equal(otherKey.order.id,result.order.id)
  await assert.rejects(orders('admin/orders/request/pos-order',{paymentMode:'COD'},{requestKey:'invoice-request-key-001'}),{status:409})
  assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/pos_orders`))).size,1);assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/pos_payments`))).size,0)
  assert.equal((await sdk.getDoc(ref(db,'pos_shop_meta','main'))).data().saleSequence,1)
  assert.deepEqual((await sdk.getDoc(sdk.doc(db,`users/${MAIN_OWNER_UID}/orders/original`))).data(),{total:34500,paymentStatus:'unpaid'})
})
test('source full/deposit/COD arrangements retain exact money and uncertain commit retry never receives a second payment',async()=>{
  for(const [paymentMode,amount] of [['FULL',34500],['PARTIAL',10000],['COD',0],['PARTIAL_COD',10000]]){
    const{db}=await fixture(),body={paymentMode,...(amount?{initialPayment:{method:'Bank',amount}}:{})};let lose=true
    const interrupted={...sdk,async runTransaction(...args){const value=await sdk.runTransaction(...args);if(lose&&(await sdk.getDocs(sdk.collection(db,`${root}/pos_orders`))).size){lose=false;throw Error('Invoice response lost after commit')}return value}}
    const orders=createDirectOrdersClient({db,auth,sdk:interrupted})
    await assert.rejects(orders('admin/orders/request/pos-order',body,{requestKey:'payment-request-key-001'}),/response lost/)
    const result=await orders('admin/orders/request/pos-order',body,{requestKey:'payment-request-key-001'})
    assert.equal(result.order.paymentStatus,amount===34500?'paid':amount?'partial':'unpaid')
    assert.equal(result.order.codCollectAmount,paymentMode.includes('COD')?34500-amount:0)
    const payments=(await sdk.getDocs(sdk.collection(db,`${root}/pos_payments`))).docs.map(row=>row.data())
    assert.equal(payments.length,amount?1:0);assert.equal(payments.reduce((sum,row)=>sum+row.amount,0),amount)
    await assertFails(sdk.setDoc(ref(env.authenticatedContext('outsider').firestore(),'pos_payments','fake'),{amount:1}))
    await assertFails(sdk.updateDoc(ref(db,'pos_orders',result.order.id),{total:1}))
  }
})
test('forty retained cart lines share one transferred hold; simultaneous same online handover creates one invoice',async()=>{
  const{db,orders}=await fixture({lines:40})
  const results=await Promise.all([orders('admin/orders/request/pos-order',{paymentMode:'COD'},{requestKey:'concurrent-invoice-key-001'}),orders('admin/orders/request/pos-order',{paymentMode:'COD'},{requestKey:'concurrent-invoice-key-002'})])
  assert.equal(results[0].order.id,results[1].order.id)
  assert.equal(results[0].order.items.length,40);assert.equal(results[0].order.total,34500*40)
  assert.equal(results[0].order.items.reduce((sum,item)=>sum+item.unitCost*Number(item.baseQuantity),0),12000*40)
  assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/pos_orders`))).size,1)
  assert.equal((await sdk.getDoc(ref(db,'stock_balances',scope))).data().reserved,'40')
  assert.equal((await sdk.getDoc(ref(db,'stock_batches','batch'))).data().physicalBaseQuantity,'41')
})
test('Rules reject a bypassed invoice unit-price change and missing payment witness atomically',async()=>{
  for(const attack of ['price','payment']){
    const{db}=await fixture()
    const malicious={...sdk,runTransaction(db,action){return sdk.runTransaction(db,tx=>action(new Proxy(tx,{get(target,name){
      if(name==='set')return(reference,value)=>{
        if(attack==='payment'&&reference.path.includes('/pos_payments/'))return target
        if(attack==='price'&&reference.path.includes('/pos_orders/')){const changed=structuredClone(value);changed.items[0].unitPrice=1;return target.set(reference,changed)}
        return target.set(reference,value)
      }
      const value=target[name];return typeof value==='function'?value.bind(target):value
    }})))}}
    await assert.rejects(createDirectOrdersClient({db,auth,sdk:malicious})('admin/orders/request/pos-order',{paymentMode:'FULL',initialPayment:{method:'Cash',amount:34500}},{requestKey:'tampered-invoice-key-001'}),error=>error.code==='permission-denied')
    assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/pos_orders`))).size,0)
    assert.equal((await sdk.getDoc(ref(db,'orders','request'))).data().reservation_state,'reserved')
    assert.equal((await sdk.getDoc(ref(db,'stock_balances',scope))).data().reserved,'1')
  }
})
test('accepted frozen prices survive a later POS price change; zero-total FULL creates no artificial payment',async()=>{
  let state=await fixture()
  await env.withSecurityRulesDisabled(async context=>{
    await sdk.updateDoc(ref(context.firestore(),'pos_products','pos'),{price:40000,variants:[{id:'v',name:'Brown / 1',price:40000,cost:12000}]})
  })
  const result=await state.orders('admin/orders/request/pos-order',{paymentMode:'COD'},{requestKey:'frozen-price-request-001'})
  assert.equal(result.order.total,34500);assert.equal(result.order.items[0].unitPrice,34500)
  assert.equal(result.order.items[0].pricingSnapshot.unitSymbol,'pcs')
  assert.equal(result.order.items[0].product.variants[0].price,40000)
  state=await fixture({price:0})
  const free=await state.orders('admin/orders/request/pos-order',{paymentMode:'FULL'},{requestKey:'free-invoice-request-001'})
  assert.equal(free.order.total,0);assert.equal(free.order.paymentStatus,'paid');assert.equal(free.order.items[0].unitCost,12000)
  assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/pos_payments`))).size,0)
})
test('staged invoice validation interruption and skipped sealing create no invoice/payment or stock effect before safe retry',async()=>{
  for(const attack of ['interruption','skip']){
    const{db}=await fixture();let commits=0
    const intercepted={...sdk,async runTransaction(db,action){
      const result=await sdk.runTransaction(db,tx=>action(new Proxy(tx,{get(target,name){
        if(name==='set' && attack==='skip')return(reference,value)=>target.set(reference,reference.path.includes('/pos_invoice_drafts/')&&reference.path.endsWith('/progress/main')&&value.next_chunk===1?{next_chunk:20}:value)
        const value=target[name];return typeof value==='function'?value.bind(target):value
      }})))
      if(attack==='interruption' && ++commits===2)throw Error('Invoice proof response interrupted')
      return result
    }}
    const body={paymentMode:'PARTIAL',initialPayment:{method:'Cash',amount:10000}},options={requestKey:'interrupted-invoice-key-001'}
    await assert.rejects(createDirectOrdersClient({db,auth,sdk:intercepted})('admin/orders/request/pos-order',body,options),error=>attack==='skip'?error.code==='permission-denied':/proof response interrupted/.test(error.message))
    assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/pos_orders`))).size,0)
    assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/pos_payments`))).size,0)
    assert.equal((await sdk.getDoc(ref(db,'orders','request'))).data().reservation_state,'reserved')
    assert.equal((await sdk.getDoc(ref(db,'stock_balances',scope))).data().reserved,'1')
    const saved=await createDirectOrdersClient({db,auth,sdk})('admin/orders/request/pos-order',body,options)
    assert.equal(saved.order.paymentStatus,'partial');assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/pos_payments`))).size,1)
  }
})
