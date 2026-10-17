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
const env=await initializeTestEnvironment({projectId:'demo-belle-direct-preparation',firestore:{host:'127.0.0.1',port:8088,rules:await readFile(new URL('../../BelleLocal POS app/config/firebase/firestore.direct.rules',import.meta.url),'utf8')}})
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
  const track=await sdk.getDoc(ref(state.db,'orders','request'))
  return{...state,invoice:result.order,operations:createDirectOperationsClient({db:state.db,auth,sdk}),tracking:()=>createDirectTracking({db:env.unauthenticatedContext().firestore(),sdk})(track.data().reference,'a'.repeat(64))}
}
const route=id=>`admin/pos/order-operations/${id}`
test('actual guest -> accepted POS invoice -> Preparing -> all checklist items -> Ready updates private tracking atomically without stock changes',async()=>{
  const state=await invoice(),id=state.invoice.id,operation=(await state.operations(route(id))).operation
  const balance=(await sdk.getDoc(ref(state.db,'stock_balances',scope))).data(),batch=(await sdk.getDoc(ref(state.db,'stock_batches','batch'))).data()
  assert.equal(operation.status,'PENDING')
  await assert.rejects(state.operations(`${route(id)}/ready`,{}, {method:'POST'}),error=>error.code==='OPERATION_CHANGED')
  let list=await state.operations('admin/pos/order-operations?status=NOT_READY&search=Yu&pageSize=25')
  assert.equal(list.entries.length,1);assert.equal(list.entries[0].operation.order.customer.name,'Yu')
  await state.operations(`${route(id)}/start`,{}, {method:'POST'})
  assert.equal((await state.tracking()).status,'packing')
  assert.equal((await state.tracking()).events.filter(row=>row.status==='packing').length,1)
  await state.operations(`${route(id)}/start`,{}, {method:'POST'})
  await assert.rejects(state.operations(`${route(id)}/ready`,{}, {method:'POST'}),/Prepare all items/)
  await state.operations(`${route(id)}/items/${state.invoice.items[0].id}`,{prepared:true},{method:'PUT'})
  await state.operations(`${route(id)}/items/${state.invoice.items[0].id}`,{prepared:false},{method:'PUT'})
  await assert.rejects(state.operations(`${route(id)}/ready`,{}, {method:'POST'}),/Prepare all items/)
  await state.operations(`${route(id)}/items/${state.invoice.items[0].id}`,{prepared:true},{method:'PUT'})
  const ready=await state.operations(`${route(id)}/ready`,{}, {method:'POST'})
  assert.equal(ready.operation.status,'READY');assert.equal(ready.operation.readyById,MAIN_OWNER_UID)
  await state.operations(`${route(id)}/ready`,{}, {method:'POST'})
  list=await state.operations('admin/pos/order-operations?status=READY')
  assert.equal(list.entries.length,1);assert.equal((await state.operations('admin/pos/order-operations?status=NOT_READY')).entries.length,0)
  await assert.rejects(state.operations(`${route(id)}/items/${state.invoice.items[0].id}`,{prepared:false},{method:'PUT'}),/Only Preparing/)
  const tracking=await state.tracking();assert.equal(tracking.status,'packing')
  for(const value of ['Private address','09999999999','unitCost','preparedById'])assert.equal(JSON.stringify(tracking).includes(value),false)
  assert.deepEqual((await sdk.getDoc(ref(state.db,'stock_balances',scope))).data(),balance)
  assert.deepEqual((await sdk.getDoc(ref(state.db,'stock_batches','batch'))).data(),batch)
  assert.deepEqual((await sdk.getDoc(sdk.doc(state.db,`users/${MAIN_OWNER_UID}/orders/original`))).data(),{total:34500,paymentStatus:'unpaid'})
})
test('Rules deny skipped readiness, checklist aggregate tampering, outsider edits and forged item identity',async()=>{
  const state=await invoice(),id=state.invoice.id,operation=(await state.operations(route(id))).operation
  await state.operations(`${route(id)}/start`,{}, {method:'POST'})
  await assertFails(sdk.runTransaction(state.db,async tx=>{
    const fence=ref(state.db,'direct_stock_meta','main'),value=(await tx.get(fence)).data()
    tx.update(ref(state.db,'pos_order_operations',operation.id),{status:'READY',readyAt:new Date().toISOString(),readyById:MAIN_OWNER_UID,updatedAt:new Date().toISOString()})
    tx.set(fence,{version:value.version+1})
  }))
  await assertFails(sdk.setDoc(ref(env.authenticatedContext('outsider').firestore(),'pos_preparation_items',state.invoice.items[0].id),{prepared:true}))
  const malicious={...sdk,runTransaction(db,action){return sdk.runTransaction(db,tx=>action(new Proxy(tx,{get(target,name){
    if(name==='set')return(reference,value)=>{const changed=structuredClone(value);if(reference.path.includes('/pos_preparation_checks/'))changed.lastItemId='forged';return target.set(reference,changed)}
    const value=target[name];return typeof value==='function'?value.bind(target):value
  }})))}}
  await assert.rejects(createDirectOperationsClient({db:state.db,auth,sdk:malicious})(`${route(id)}/items/${state.invoice.items[0].id}`,{prepared:true},{method:'PUT'}),error=>error.code==='permission-denied')
  assert.equal((await sdk.getDoc(ref(state.db,'pos_order_operations',operation.id))).data().status,'PREPARING')
  assert.equal((await sdk.getDocs(sdk.collection(state.db,`${root}/pos_preparation_items`))).size,0)
})
test('Rules reject operation mutation without its linked tracking projection and preserve the active owner capability gate',async()=>{
  const state=await invoice(),id=state.invoice.id
  const malicious={...sdk,runTransaction(db,action){return sdk.runTransaction(db,tx=>action(new Proxy(tx,{get(target,name){
    if(name==='set')return(reference,value)=>reference.path.includes('/public_tracking/')?target:target.set(reference,value)
    const value=target[name];return typeof value==='function'?value.bind(target):value
  }})))}}
  await assert.rejects(createDirectOperationsClient({db:state.db,auth,sdk:malicious})(`${route(id)}/start`,{}, {method:'POST'}),error=>error.code==='permission-denied')
  assert.equal((await state.operations(route(id))).operation.status,'PENDING')
  assert.equal((await state.tracking()).status,'confirmed')
  await env.withSecurityRulesDisabled(async context=>{await sdk.updateDoc(ref(context.firestore(),'direct_runtime','main'),{pos_operations_enabled:false})})
  await assert.rejects(state.operations(`${route(id)}/start`,{}, {method:'POST'}),{status:409})
  assert.equal((await state.operations(route(id))).operation.status,'PENDING')
})
test('forty-line checklist must prepare every exact invoice item before Ready; concurrent toggles share the aggregate fence',async()=>{
  const state=await invoice({lines:40}),id=state.invoice.id
  await state.operations(`${route(id)}/start`,{}, {method:'POST'})
  const toggle=item=>state.operations(`${route(id)}/items/${item.id}`,{prepared:true},{method:'PUT'})
  await Promise.all(state.invoice.items.slice(0,2).map(toggle))
  for(const item of state.invoice.items.slice(2,39))await toggle(item)
  await assert.rejects(state.operations(`${route(id)}/ready`,{}, {method:'POST'}),/Prepare all items/)
  await toggle(state.invoice.items[39])
  assert.equal((await state.operations(`${route(id)}/ready`,{}, {method:'POST'})).operation.status,'READY')
  assert.equal((await state.tracking()).items.length,40)
  assert.equal((await sdk.getDoc(ref(state.db,'stock_balances',scope))).data().reserved,'40')
})
test('mounted Operations Report retains the source newest-250 limit, actor attribution and group-after-limit semantics',async()=>{
  const state=await invoice(),id=state.invoice.id
  await state.operations(`${route(id)}/start`,{}, {method:'POST'})
  await state.operations(`${route(id)}/items/${state.invoice.items[0].id}`,{prepared:true},{method:'PUT'})
  await state.operations(`${route(id)}/ready`,{}, {method:'POST'})
  const reports=createDirectReportsClient({db:state.db,auth,sdk})
  const current=await reports('admin/pos/reports/operations')
  assert.ok(current.events.some(row=>row.action==='operation.start'))
  assert.equal(current.events.find(row=>row.action==='operation.start').actor.name,'Belle Owner')
  assert.equal(current.events.find(row=>row.action==='operation.start').actor.role,'OWNER')
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(),batch=sdk.writeBatch(db)
    for(let index=0;index<260;index++)batch.set(ref(db,'pos_audit',`source-${index}`),{id:`source-${index}`,shopId:'belle-online',actorId:MAIN_OWNER_UID,action:index>=250?'inventory.adjust':'order.create',entity:'Order',entityId:id,metadata:{},createdAt:new Date(Date.parse('2026-10-14T00:00:00.000Z')+index*1000).toISOString()})
    await batch.commit()
  })
  const source=await reports('admin/pos/reports/operations?from=2026-10-14&to=2026-10-14&group=Sales')
  assert.ok(source.events.length>0 && source.events.length<250)
  assert.equal(source.events.some(row=>row.id.startsWith('source-')&&Number(row.id.slice(7))<10),false)
  await assert.rejects(reports('admin/pos/reports/operations?branchId=other'),{status:403})
})
