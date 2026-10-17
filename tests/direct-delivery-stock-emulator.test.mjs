import {createDirectDeliveryStock} from '../../BelleLocal POS app/src/features/firebase-direct/delivery-stock.js'
import {createDirectOnlineRepository} from '../../BelleLocal POS app/src/features/firebase-direct/read-repository.js'
import {digest} from '../../BelleLocal POS app/src/shared/pos-domain/mutation.js'
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
const env=await initializeTestEnvironment({projectId:'demo-belle-direct-delivery-stock',firestore:{host:'127.0.0.1',port:8088,rules:await readFile(new URL('../../BelleLocal POS app/config/firebase/firestore.direct.rules',import.meta.url),'utf8')}})
test.after(()=>env.cleanup())
const root='onlineShopV2/belle-online',scope=await directStockScope('pos','v'),ref=(db,table,id)=>sdk.doc(db,`${root}/${table}/${id}`),owner=()=>env.authenticatedContext(MAIN_OWNER_UID).firestore(),auth={currentUser:{uid:MAIN_OWNER_UID,displayName:'Belle Owner'}}
async function fixture({lines=1,price=34500}={}){
  await env.clearFirestore()
  const db=owner(),choices=Array.from({length:lines},(_,index)=>`choice-${index}`)
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(),batch=sdk.writeBatch(db)
    batch.set(ref(db,'direct_runtime','main'),{stock_authority:'ledger-v2',online_orders_enabled:true,pos_orders_enabled:true,pos_operations_enabled:true,backend_writers_stopped:true,original_writers_stopped:true,direct_guest_protocol:'fifo-frame-v1',guest_checkout_enabled:true})
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
  return{...state,invoice:result.order}
}
function consumer(state){
  const repository=createDirectOnlineRepository({db:state.db,auth,sdk}),stock=createDirectDeliveryStock({db:repository})
  return(key,allocations=state.invoice.items.flatMap(item=>item.allocations))=>repository.runTransaction(async tx=>{
    const plan=await stock.prepareReservation(tx,'belle-online',{productId:'pos',variantId:'v',sourceType:'PosOrder',sourceId:state.invoice.id,action:'consume'},MAIN_OWNER_UID,key,{saleAllocations:allocations,saleKeyPrefix:'handover:test:'})
    plan.apply();return plan.result
  })
}
test('actual SDK delivery stock plan consumes transferred hold once with source per-item movement identities and frozen cost; originals are untouched',async()=>{
  const state=await invoice({lines:2}),consume=consumer(state)
  const result=await consume('delivery-consumer-key-001')
  assert.equal(result.quantity,'2');assert.equal(result.status,'CONSUMED');assert.equal(result.totalCost,'24000')
  const balance=(await sdk.getDoc(ref(state.db,'stock_balances',scope))).data(),batch=(await sdk.getDoc(ref(state.db,'stock_batches','batch'))).data()
  assert.equal(balance.onHand,'1');assert.equal(balance.reserved,'0')
  assert.equal(batch.baseQuantity,'3');assert.equal(batch.physicalBaseQuantity,'1');assert.equal(batch.heldBaseQuantity,'0');assert.equal(batch.consumedBaseQuantity,'2')
  const movements=(await sdk.getDocs(sdk.collection(state.db,`${root}/stock_movements`))).docs.map(row=>row.data())
  assert.equal(movements.length,2)
  for(const allocation of state.invoice.items.flatMap(item=>item.allocations)){
    const movement=movements.find(row=>row.id===digest(['pos-sale',allocation.id]))
    assert.equal(movement.sourceType,'OrderItemAllocation');assert.equal(movement.sourceId,allocation.id);assert.equal(movement.unitCost,12000)
    assert.equal(movement.idempotencyKey,`handover:test:sale:${allocation.id}`)
  }
  const saved=JSON.stringify({balance,batch,movements})
  await assert.rejects(consume('delivery-consumer-key-001'),{status:409})
  await assert.rejects(consume('delivery-consumer-key-002'),{status:409})
  assert.equal(JSON.stringify({balance:(await sdk.getDoc(ref(state.db,'stock_balances',scope))).data(),batch:(await sdk.getDoc(ref(state.db,'stock_batches','batch'))).data(),movements:(await sdk.getDocs(sdk.collection(state.db,`${root}/stock_movements`))).docs.map(row=>row.data())}),saved)
  assert.deepEqual((await sdk.getDoc(sdk.doc(state.db,`users/${MAIN_OWNER_UID}/orders/original`))).data(),{total:34500,paymentStatus:'unpaid'})
})
test('wrong invoice allocation quantity/cost or missing slices rejects before any physical change',async()=>{
  const state=await invoice(),consume=consumer(state),allocation=state.invoice.items[0].allocations[0]
  for(const value of [[{...allocation,baseQuantity:'2'}],[{...allocation,unitCost:1}],[]])await assert.rejects(consume('bad-consumption-key-001',value),{status:409})
  assert.equal((await sdk.getDoc(ref(state.db,'stock_balances',scope))).data().reserved,'1')
  assert.equal((await sdk.getDoc(ref(state.db,'stock_batches','batch'))).data().physicalBaseQuantity,'2')
  assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/stock_movements`))).size,0)
})
