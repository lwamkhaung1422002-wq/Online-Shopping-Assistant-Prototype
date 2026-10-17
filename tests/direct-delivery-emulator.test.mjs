import {signatureFixture} from './handover-signature-fixture.mjs'
import {createDirectOperationsClient} from '../../BelleLocal POS app/src/features/firebase-direct/operations-client.js'
import {createDirectReportsClient} from '../../BelleLocal POS app/src/features/firebase-direct/reports-client.js'
import {createDirectTracking} from '../dashboard/shared/direct-tracking.js'
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
const env=await initializeTestEnvironment({projectId:'demo-belle-direct-delivery',firestore:{host:'127.0.0.1',port:8088,rules:await readFile(new URL('../../BelleLocal POS app/config/firebase/firestore.direct.rules',import.meta.url),'utf8')}})
test.after(()=>env.cleanup())
const root='onlineShopV2/belle-online',scope=await directStockScope('pos','v'),ref=(db,table,id)=>sdk.doc(db,`${root}/${table}/${id}`),owner=()=>env.authenticatedContext(MAIN_OWNER_UID).firestore(),auth={currentUser:{uid:MAIN_OWNER_UID,displayName:'Belle Owner'}}
async function fixture({lines=1,price=34500}={}){
  await env.clearFirestore()
  const db=owner(),choices=Array.from({length:lines},(_,index)=>`choice-${index}`)
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(),batch=sdk.writeBatch(db)
    batch.set(ref(db,'direct_runtime','main'),{stock_authority:'ledger-v2',online_orders_enabled:true,pos_orders_enabled:true,pos_operations_enabled:true,pos_deliveries_enabled:true,backend_writers_stopped:true,original_writers_stopped:true,direct_guest_protocol:'fifo-frame-v1',guest_checkout_enabled:true})
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
async function invoice(options={}){
  const state=await fixture(options),result=await state.orders('admin/orders/request/pos-order',{paymentMode:'COD'},{requestKey:'preparation-invoice-key-001'})
  const track=await sdk.getDoc(ref(state.db,'orders','request'))
  return{...state,invoice:result.order,operations:createDirectOperationsClient({db:state.db,auth,sdk}),tracking:()=>createDirectTracking({db:env.unauthenticatedContext().firestore(),sdk})(track.data().reference,'a'.repeat(64))}
}
const route=id=>`admin/pos/order-operations/${id}`
async function ready(options={}){
  const state=await invoice(options),id=state.invoice.id
  await state.operations(`${route(id)}/start`,{}, {method:'POST'})
  for(const item of state.invoice.items)await state.operations(`${route(id)}/items/${item.id}`,{prepared:true},{method:'PUT'})
  await state.operations(`${route(id)}/ready`,{}, {method:'POST'})
  return state
}
const deliveryBody=orders=>({orderIds:orders.map(order=>order.id),receiverName:'Courier',receiverPhone:'09922222222',signatureDataUrl:signatureFixture(),verifiedItems:orders.flatMap(order=>order.items.map(item=>({orderItemId:item.id,quantity:String(Number(item.enteredQuantity??item.quantity)),unit:item.pricingSnapshot.unitSymbol??''})))})
const save=(state,body=deliveryBody([state.invoice]),key='direct-delivery-request-001')=>state.operations('admin/pos/delivery-handovers',body,{method:'POST',requestKey:key})
test('actual guest through Ready -> signed delivery consumes stock once, saves frozen snapshots and ships private tracking with replay',async()=>{
  const state=await ready(),result=await save(state)
  assert.equal(result.handover.deliveryNumber,'DLV-00001');assert.equal(result.handover.orders[0].snapshot.remainingAmount,34500)
  assert.equal(result.handover.createdByName,'Belle Owner');assert.equal(result.handover.receiverName,'Courier')
  assert.equal((await state.operations(route(state.invoice.id))).operation.status,'COMPLETED')
  assert.equal((await state.orders(`admin/pos/orders/${state.invoice.id}`)).order.fulfillmentStatus,'completed')
  assert.equal((await sdk.getDoc(ref(state.db,'stock_balances',scope))).data().onHand,'1')
  assert.equal((await sdk.getDoc(ref(state.db,'stock_balances',scope))).data().reserved,'0')
  const tracking=await state.tracking()
  assert.equal(tracking.status,'shipped');assert.equal(tracking.courier,'Courier');assert.equal(tracking.delivery_reference,'DLV-00001')
  for(const value of['signatureDataUrl','09922222222','09999999999','Private address','unitCost'])assert.equal(JSON.stringify(tracking).includes(value),false)
  const replay=await save(state);assert.equal(replay.handover.id,result.handover.id);assert.equal(replay.replayed,true)
  await assert.rejects(save(state,{...deliveryBody([state.invoice]),receiverName:'Changed'}),error=>error.code==='IDEMPOTENCY_CONFLICT')
  await assert.rejects(save(state,deliveryBody([state.invoice]),'different-delivery-key-001'),error=>error.code==='OPERATION_CHANGED')
  assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/pos_delivery_handovers`))).size,1)
  assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/stock_movements`))).size,1)
  await state.online('admin/orders/request/transition',{status:'delivered'})
  assert.equal((await state.tracking()).status,'delivered')
  assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/stock_movements`))).size,1)
  assert.deepEqual((await sdk.getDoc(sdk.doc(state.db,`users/${MAIN_OWNER_UID}/orders/original`))).data(),{total:34500,paymentStatus:'unpaid'})
})
test('invalid signature/item verification and not-Ready or disabled delivery reject before stock or membership effects',async()=>{
  let state=await invoice()
  await assert.rejects(save(state),error=>error.code==='OPERATION_CHANGED')
  state=await ready()
  await assert.rejects(save(state,{...deliveryBody([state.invoice]),signatureDataUrl:signatureFixture(false)}),/signature/)
  await assert.rejects(save(state,{...deliveryBody([state.invoice]),verifiedItems:[]}),/small|Verify|at least/i)
  await assert.rejects(save(state,{...deliveryBody([state.invoice]),verifiedItems:[{orderItemId:state.invoice.items[0].id,quantity:'2',unit:'pcs'}]}),/Verify every item/)
  await env.withSecurityRulesDisabled(async context=>{await sdk.updateDoc(ref(context.firestore(),'direct_runtime','main'),{pos_deliveries_enabled:false})})
  await assert.rejects(save(state),{status:409})
  assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/pos_delivery_memberships`))).size,0)
  assert.equal((await sdk.getDoc(ref(state.db,'stock_balances',scope))).data().reserved,'1')
})
test('two invoices sharing one FIFO batch compose one atomic delivery with frozen snapshots and current public physical availability',async()=>{
  const state=await ready(),user={uid:'second-buyer',isAnonymous:true},guest=env.authenticatedContext(user.uid).firestore()
  await createFrozenOrderRepository({db:guest,auth:{currentUser:user},sdk,authenticate:async()=>user}).submit({request_key:'second-request',tracking_token:'b'.repeat(64),customer:{name:'Other',phone:'09999999998',city:'Yangon',address:'Other address'},items:[{variant_id:'choice-0',quantity:1}]})
  await state.online('admin/records/orders');await state.online('admin/orders/second-request/transition',{status:'confirmed'})
  const second=(await state.orders('admin/orders/second-request/pos-order',{paymentMode:'COD'},{requestKey:'second-invoice-request-001'})).order
  await state.operations(`${route(second.id)}/start`,{}, {method:'POST'})
  for(const item of second.items)await state.operations(`${route(second.id)}/items/${item.id}`,{prepared:true},{method:'PUT'})
  await state.operations(`${route(second.id)}/ready`,{}, {method:'POST'})
  const result=await save(state,deliveryBody([state.invoice,second]))
  assert.equal(result.handover.orders.length,2)
  const balance=(await sdk.getDoc(ref(state.db,'stock_balances',scope))).data()
  assert.equal(balance.onHand,'0');assert.equal(balance.reserved,'0')
  const batch=(await sdk.getDoc(ref(state.db,'stock_batches','batch'))).data()
  assert.equal(batch.physicalBaseQuantity,'0');assert.equal(batch.consumedBaseQuantity,'2');assert.equal(batch.baseQuantity,'2')
  assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/stock_movements`))).size,2)
  assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/pos_delivery_memberships`))).size,2)
  const publicStock=(await sdk.getDoc(ref(state.db,'public_stock','choice-0'))).data()
  assert.equal(publicStock.available,0)
  assert.equal(publicStock.source_revision,(await sdk.getDoc(ref(state.db,'direct_stock_meta','main'))).data().version)
  await env.withSecurityRulesDisabled(async context=>{await sdk.updateDoc(ref(context.firestore(),'pos_customers',state.invoice.customerId),{name:'Changed contact'})})
  const saved=(await state.operations(`admin/pos/delivery-handovers/${result.handover.id}`)).handover
  assert.equal(saved.orders.find(row=>row.orderId===state.invoice.id).snapshot.customer.name,'Yu')
  assert.equal((await state.tracking()).status,'shipped')
})
test('uncertain committed delivery response reuses one handover/sequence and competing delivery keys cannot consume the invoice twice',async()=>{
  let state=await ready();let lose=true
  const lost={...sdk,async runTransaction(...args){const result=await sdk.runTransaction(...args);if(lose&&(await sdk.getDocs(sdk.collection(state.db,`${root}/pos_delivery_handovers`))).size){lose=false;throw Error('Delivery response lost')}return result}}
  const operations=createDirectOperationsClient({db:state.db,auth,sdk:lost}),body=deliveryBody([state.invoice]),options={method:'POST',requestKey:'uncertain-delivery-key-001'}
  await assert.rejects(operations('admin/pos/delivery-handovers',body,options),/response lost/)
  const replay=await operations('admin/pos/delivery-handovers',body,options)
  assert.equal(replay.replayed,true);assert.equal((await sdk.getDoc(ref(state.db,'pos_shop_meta','main'))).data().deliverySequence,1)
  assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/stock_movements`))).size,1)
  state=await ready()
  const result=await Promise.allSettled([save(state,deliveryBody([state.invoice]),'competing-delivery-key-001'),save(state,deliveryBody([state.invoice]),'competing-delivery-key-002')])
  assert.equal(result.filter(row=>row.status==='fulfilled').length,1)
  assert.equal(result.filter(row=>row.status==='rejected'&&row.reason.code==='OPERATION_CHANGED').length,1)
  assert.equal((await sdk.getDoc(ref(state.db,'stock_balances',scope))).data().onHand,'1')
  assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/pos_delivery_handovers`))).size,1)
})
test('Rules rollback missing membership/tracking or a changed invoice total; outsider cannot read or create signed handovers',async()=>{
  for(const attack of ['membership','tracking','total']){
    const state=await ready()
    const malicious={...sdk,runTransaction(db,action){return sdk.runTransaction(db,tx=>action(new Proxy(tx,{get(target,name){
      if(name==='set')return(reference,value)=>{
        if(attack==='membership'&&reference.path.includes('/pos_delivery_memberships/') || attack==='tracking'&&reference.path.includes('/public_tracking/'))return target
        return target.set(reference,value)
      }
      if(name==='update')return(reference,value)=>target.update(reference,attack==='total'&&reference.path.includes('/pos_orders/')?{...value,total:1}:value)
      const value=target[name];return typeof value==='function'?value.bind(target):value
    }})))}}
    await assert.rejects(createDirectOperationsClient({db:state.db,auth,sdk:malicious})('admin/pos/delivery-handovers',deliveryBody([state.invoice]),{method:'POST',requestKey:'tampered-delivery-key-001'}),error=>error.code==='permission-denied')
    assert.equal((await sdk.getDoc(ref(state.db,'pos_orders',state.invoice.id))).data().fulfillmentStatus,'reserved')
    assert.equal((await sdk.getDoc(ref(state.db,'stock_balances',scope))).data().reserved,'1')
    assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/pos_delivery_handovers`))).size,0)
    await assertFails(sdk.setDoc(ref(env.authenticatedContext('outsider').firestore(),'pos_delivery_handovers','fake'),deliveryBody([state.invoice])))
    await assertFails(sdk.getDoc(ref(env.unauthenticatedContext().firestore(),'pos_delivery_handovers','fake')))
  }
})
test('forty retained verified items ship together with forty immutable allocation SALE facts and one physical hold consumption',async()=>{
  const state=await ready({lines:40}),result=await save(state)
  assert.equal(result.handover.verifiedItems.length,40)
  assert.equal(result.handover.orders[0].snapshot.items.length,40)
  assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/stock_movements`))).size,40)
  assert.equal((await sdk.getDoc(ref(state.db,'stock_balances',scope))).data().onHand,'1')
  assert.equal((await sdk.getDoc(ref(state.db,'stock_balances',scope))).data().reserved,'0')
  assert.equal((await state.tracking()).items.length,40)
  assert.equal((await state.tracking()).status,'shipped')
})
