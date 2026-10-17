import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import {createCheckoutFrameRepository} from '../../BelleLocal POS app/src/features/firebase-direct/checkout-frame-repository.js'
import {directStockScope} from '../../BelleLocal POS app/src/features/firebase-direct/availability-model.js'
import {MAIN_OWNER_UID} from '../../BelleLocal POS app/src/features/firebase-direct/content-model.js'
import {createFrozenOrderRepository} from '../dashboard/shared/frozen-order-repository.js'
import {createDirectTracking} from '../dashboard/shared/direct-tracking.js'
import {createDirectOnlineClient} from '../../BelleLocal POS app/src/features/firebase-direct/online-client.js'
import {createDirectReservationRepository} from '../../BelleLocal POS app/src/features/firebase-direct/reservation-repository.js'
const require=createRequire(new URL('../../BelleLocal POS app/package.json',import.meta.url)),sdk=require('firebase/firestore')
const{initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing')
if(process.env.DIRECT_FIRESTORE_EMULATOR!=='127.0.0.1:8088')throw Error('Use the isolated direct emulator.')
const env=await initializeTestEnvironment({projectId:'demo-belle-direct-frozen-guest',firestore:{host:'127.0.0.1',port:8088,rules:await readFile(new URL('../../BelleLocal POS app/config/firebase/firestore.direct.rules',import.meta.url),'utf8')}})
test.after(()=>env.cleanup())
const root='onlineShopV2/belle-online',scope=await directStockScope('pos','v'),ref=(db,table,id)=>sdk.doc(db,`${root}/${table}/${id}`),owner=()=>env.authenticatedContext(MAIN_OWNER_UID).firestore()
async function fixture({lines=1,capacity=2}={}){
  await env.clearFirestore()
  const choices=Array.from({length:lines},(_,index)=>lines===1?'choice':`choice-${index}`)
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(),batch=sdk.writeBatch(db)
    batch.set(ref(db,'direct_runtime','main'),{stock_authority:'ledger-v2',online_orders_enabled:true,backend_writers_stopped:true,original_writers_stopped:true,direct_guest_protocol:'fifo-frame-v1',guest_checkout_enabled:true})
    batch.set(ref(db,'pos_products','pos'),{id:'pos',trackingMode:'NONE',variants:[{id:'v',price:34500}]})
    batch.set(ref(db,'stock_balances',scope),{productId:'pos',variantId:'v',onHand:String(capacity),reserved:'0',version:1})
    batch.set(ref(db,'stock_batches','batch'),{id:'batch',productId:'pos',variantId:'v',scopeKey:scope,quantity:capacity,reservedQuantity:0,baseQuantity:String(capacity),reservedBaseQuantity:'0',physicalBaseQuantity:String(capacity),heldBaseQuantity:'0',consumedBaseQuantity:'0',unitCost:12000,receivedAt:'2026-07-23'})
    for(const id of choices)batch.set(ref(db,'stock_bindings',id),{id,public_variant_id:id,public_product_id:'post',pos_product_id:'pos',pos_variant_id:'v',scope_key:scope})
    batch.set(ref(db,'products','post'),{id:'post',name:'Elegence',status:'published',variants:choices.map(id=>({id,color:'Brown',size:'1',active:true}))})
    batch.set(sdk.doc(db,`users/${MAIN_OWNER_UID}/orders/original`),{total:34500,paymentStatus:'unpaid'})
    await batch.commit()
  })
  await createCheckoutFrameRepository({db:owner(),auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk}).publish({enable:true})
  return choices
}
function customer(uid='buyer'){
  const db=env.authenticatedContext(uid).firestore(),user={uid,isAnonymous:true},auth={currentUser:user}
  return{db,service:createFrozenOrderRepository({db,auth,sdk,authenticate:async()=>user})}
}
const input=(key='request',quantity=1,choices=['choice'])=>({request_key:key,tracking_token:'a'.repeat(64),customer:{name:'Private buyer',phone:'09999999999',city:'Yangon',address:'Private address'},note:'Private note',items:choices.map(variant_id=>({variant_id,quantity,measurements:{weight:100}}))})
test('actual SDK frozen guest submission validates quantity/price and retries once; pending private tracking works with owner browser absent',async()=>{
  await fixture();const{db,service}=customer(),request=input()
  await assert.rejects(service.submit(input('too-many',3)),{status:409})
  const response=await service.submit(request)
  assert.deepEqual(await service.submit(request),response)
  await assert.rejects(service.submit({...request,note:'changed'}),{status:409})
  const business=owner(),order=(await sdk.getDoc(ref(business,'orders','request'))).data()
  assert.equal(order.total,34500);assert.equal(order.status,'pending')
  assert.equal((await sdk.getDoc(ref(business,'public_checkout_book','main'))).data().cursors[scope],1)
  assert.equal((await sdk.getDocs(sdk.collection(business,`${root}/orders`))).size,1)
  assert.equal((await sdk.getDocs(sdk.collection(business,`${root}/checkout_drafts/${order.draft_id}/chunks`))).size,20)
  const tracking=await createDirectTracking({db:env.unauthenticatedContext().firestore(),sdk})(response.reference,response.tracking_token)
  assert.equal(tracking.status,'pending');assert.equal(tracking.items[0].unit_price,34500)
  for(const value of['Private buyer','Private address','Private note','09999999999','unitCost'])assert.equal(JSON.stringify(tracking).includes(value),false)
  await assertFails(sdk.getDoc(ref(db,'orders','request')))
  await assertFails(sdk.getDocs(sdk.collection(db,`${root}/public_submission_receipts`)))
  await assertFails(sdk.getDoc(ref(env.authenticatedContext('other').firestore(),'public_submission_receipts','request')))
  assert.deepEqual((await sdk.getDoc(sdk.doc(business,`users/${MAIN_OWNER_UID}/orders/original`))).data(),{total:34500,paymentStatus:'unpaid'})
})
test('three concurrent actual SDK submissions reserve only two rights and keep exact replay under uncertain returned response',async()=>{
  await fixture()
  const outcomes=await Promise.allSettled(['a','b','c'].map(key=>customer(key).service.submit(input(key))))
  assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,2,JSON.stringify(outcomes.map(row=>row.reason?.message || 'saved')))
  assert.equal(outcomes.filter(row=>row.status==='rejected' && row.reason.status===409).length,1)
  assert.equal((await sdk.getDoc(ref(owner(),'public_checkout_book','main'))).data().cursors[scope],2)
  await fixture()
  const user={uid:'uncertain',isAnonymous:true},db=env.authenticatedContext(user.uid).firestore();let once=true
  const lost={...sdk,async runTransaction(...args){const result=await sdk.runTransaction(...args);if(once && (await sdk.getDoc(ref(db,'public_submission_receipts','uncertain'))).exists()){once=false;throw new Error('Response lost after commit')}return result}}
  const service=createFrozenOrderRepository({db,auth:{currentUser:user},sdk:lost,authenticate:async()=>user})
  await assert.rejects(service.submit(input('uncertain')),/Response lost/)
  await service.submit(input('uncertain'))
  assert.equal((await sdk.getDoc(ref(owner(),'public_checkout_book','main'))).data().cursors[scope],1)
  assert.equal((await sdk.getDocs(sdk.collection(owner(),`${root}/orders`))).size,1)
})
test('forty distinct aliases keep all twenty price/quantity proof chunks and one grouped FIFO interval without lowering cart size',async()=>{
  const count=40,choices=await fixture({lines:count,capacity:count*2}),response=await customer().service.submit(input('forty',1,choices))
  const business=owner(),order=(await sdk.getDoc(ref(business,'orders','forty'))).data()
  assert.equal(order.item_count,count);assert.equal(order.total,34500*count);assert.equal(order.group_keys.length,1)
  assert.equal((await sdk.getDoc(ref(business,'public_checkout_book','main'))).data().cursors[scope],count)
  assert.equal((await createDirectTracking({db:env.unauthenticatedContext().firestore(),sdk})(response.reference,response.tracking_token)).items.length,count)
})
test('Rules reject bypassed client price/quantity/prefix/group edits and skipped proof sealing; failed staging creates no order or stock hold',async()=>{
  for(const attack of ['price','quantity','prefix','cursor','skip','unreserved']){
    await fixture();const user={uid:`attack-${attack}`,isAnonymous:true},db=env.authenticatedContext(user.uid).firestore()
    const malicious={...sdk,runTransaction(db,action){return sdk.runTransaction(db,tx=>{
      const proxy=new Proxy(tx,{get(target,name){if(name==='set')return(reference,value)=>{
        if(attack==='unreserved' && (reference.path.endsWith('/public_checkout_book/main') || reference.path.endsWith('/direct_stock_meta/main')))return target
        const changed=structuredClone(value)
        if(reference.path.includes('/chunks/0') && changed.items.length){
          if(attack==='price')changed.items[0].unit_price=1
          if(attack==='quantity')changed.items[0].quantity=3
          if(attack==='prefix')changed.items[0].prefix_quantity=0
        }
        if(reference.path.includes('/checkout_drafts/') && !reference.path.includes('/progress/') && !reference.path.includes('/chunks/') && attack==='cursor')changed.next_cursors[scope]=0
        if(reference.path.includes('/progress/') && changed.next_chunk===1 && attack==='skip')changed.next_chunk=20
        // Preserve SDK server timestamp sentinels when only plain proof maps
        // need tampering; cloning transforms would instead test SDK parsing.
        return target.set(reference,reference.path.includes('/chunks/') || reference.path.includes('/progress/') ? changed : attack==='cursor' && changed.next_cursors ? {...value,next_cursors:changed.next_cursors} : value)
      };const value=target[name];return typeof value==='function'?value.bind(target):value}})
      return action(proxy)
    })}}
    const service=createFrozenOrderRepository({db,auth:{currentUser:user},sdk:malicious,authenticate:async()=>user})
    await assert.rejects(service.submit(input(`attack-${attack}`)),error=>error.code==='permission-denied')
    assert.equal((await sdk.getDocs(sdk.collection(owner(),`${root}/orders`))).size,0)
    assert.equal((await sdk.getDoc(ref(owner(),'public_checkout_book','main'))).data().cursors[scope],0)
    assert.equal((await sdk.getDoc(ref(owner(),'stock_balances',scope))).data().reserved,'0')
  }
})
test('proof interruption does not reserve stock; same-key retry resumes immutable validation and preserves customer measurements',async()=>{
  await fixture();const user={uid:'interrupted',isAnonymous:true},db=env.authenticatedContext(user.uid).firestore();let commits=0
  const interrupted={...sdk,async runTransaction(...args){const result=await sdk.runTransaction(...args);if(++commits===3)throw new Error('Proof response interrupted');return result}}
  const options={db,auth:{currentUser:user},authenticate:async()=>user}
  await assert.rejects(createFrozenOrderRepository({...options,sdk:interrupted}).submit(input('interrupted')),/Proof response interrupted/)
  assert.equal((await sdk.getDocs(sdk.collection(owner(),`${root}/orders`))).size,0)
  assert.equal((await sdk.getDoc(ref(owner(),'public_checkout_book','main'))).data().cursors[scope],0)
  const value=await createFrozenOrderRepository({...options,sdk}).submit(input('interrupted'))
  assert.match(value.reference,/^OS-/)
  const order=(await sdk.getDoc(ref(owner(),'orders','interrupted'))).data(),chunk=(await sdk.getDoc(sdk.doc(owner(),`${root}/checkout_drafts/${order.draft_id}/chunks/0`))).data()
  assert.deepEqual(chunk.items[0].measurements,{weight:100})
  assert.equal((await sdk.getDoc(ref(owner(),'public_checkout_book','main'))).data().cursors[scope],1)
})
test('real customer submission appears in POS, adopts frozen FIFO cost exactly once, accepts draft and cancels without a second stock grant',async()=>{
  await fixture();const request=input('workflow'),response=await customer().service.submit(request),db=owner(),online=createDirectOnlineClient({db,auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk})
  assert.equal((await sdk.getDoc(ref(db,'stock_balances',scope))).data().reserved,'0')
  let rows=await online('admin/records/orders')
  assert.equal(rows.length,1);assert.equal(rows[0].items[0].product_name,'Elegence');assert.equal(rows[0].booking_adopted,true)
  assert.equal(rows[0].stock_reservations[0].totalCost,'12000')
  assert.equal((await sdk.getDoc(ref(db,'stock_balances',scope))).data().reserved,'1')
  assert.equal((await sdk.getDoc(ref(db,'public_checkout_book','main'))).data().cursors[scope],0)
  assert.equal((await sdk.getDoc(ref(db,'public_checkout_book','main'))).data().checkout_enabled,true)
  rows=await online('admin/records/orders');assert.equal((await sdk.getDoc(ref(db,'stock_balances',scope))).data().reserved,'1')
  assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/stock_reservations`))).size,1)
  await online('admin/orders/workflow/transition',{status:'confirmed'})
  assert.equal((await createDirectTracking({db:env.unauthenticatedContext().firestore(),sdk})(response.reference,response.tracking_token)).status,'confirmed')
  await online('admin/orders/workflow/transition',{status:'cancelled'})
  await online('admin/orders/workflow/transition',{status:'cancelled'})
  assert.equal((await sdk.getDoc(ref(db,'stock_balances',scope))).data().onHand,'2')
  assert.equal((await sdk.getDoc(ref(db,'stock_balances',scope))).data().reserved,'0')
  assert.equal((await sdk.getDoc(ref(db,'stock_batches','batch'))).data().unitCost,12000)
  assert.equal((await createDirectTracking({db:env.unauthenticatedContext().firestore(),sdk})(response.reference,response.tracking_token)).status,'cancelled')
  await customer('next-buyer').service.submit(input('next-after-release',2))
  assert.equal((await sdk.getDoc(ref(db,'public_checkout_book','main'))).data().cursors[scope],2)
})
test('owner reservation adopts outstanding customer rights before spending remaining stock; forty rows adopt one frozen aggregate hold and release once',async()=>{
  await fixture();await customer().service.submit(input('guest-hold'))
  const db=owner(),stock=createDirectReservationRepository({db,auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk})
  await stock.reservation({productId:'pos',variantId:'v',sourceType:'Order',sourceId:'pos-sale',quantity:'1'},'pos-sale')
  assert.equal((await sdk.getDoc(ref(db,'stock_balances',scope))).data().reserved,'2')
  assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/stock_reservations`))).size,2)
  await assert.rejects(stock.reservation({productId:'pos',variantId:'v',sourceType:'Order',sourceId:'oversell',quantity:'1'},'oversell'),{status:409})
  const choices=await fixture({lines:40,capacity:80}),response=await customer().service.submit(input('forty-adopt',1,choices)),online=createDirectOnlineClient({db:owner(),auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk})
  const rows=await online('admin/records/orders')
  assert.equal(rows[0].items.length,40);assert.equal(rows[0].stock_reservations.length,1);assert.equal(rows[0].stock_reservations[0].quantity,'40')
  assert.equal((await sdk.getDoc(ref(owner(),'stock_balances',scope))).data().reserved,'40')
  await online('admin/orders/forty-adopt/transition',{status:'rejected'})
  assert.equal((await sdk.getDoc(ref(owner(),'stock_balances',scope))).data().onHand,'80')
  assert.equal((await sdk.getDoc(ref(owner(),'stock_balances',scope))).data().reserved,'0')
  assert.equal((await createDirectTracking({db:env.unauthenticatedContext().firestore(),sdk})(response.reference,response.tracking_token)).items.length,40)
})
test('disabled owner preview reads sealed customer items/dates without adopting stock or allowing acceptance',async()=>{
  await fixture();await customer().service.submit(input('preview'))
  await env.withSecurityRulesDisabled(async context=>sdk.updateDoc(ref(context.firestore(),'direct_runtime','main'),{online_orders_enabled:false}))
  const db=owner(),online=createDirectOnlineClient({db,auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk}),rows=await online('admin/records/orders')
  assert.equal(rows[0].items[0].size,'1');assert.deepEqual(rows[0].items[0].measurements,{weight:100});assert.match(rows[0].created_at,/Z$/)
  assert.equal((await sdk.getDoc(ref(db,'stock_balances',scope))).data().reserved,'0')
  assert.equal((await sdk.getDoc(ref(db,'public_checkout_book','main'))).data().cursors[scope],1)
  await assert.rejects(online('admin/orders/preview/transition',{status:'confirmed'}),{status:409})
})
test('simultaneous POS reservation and customer submission cannot spend the same physical rights',async()=>{
  await fixture();const db=owner(),stock=createDirectReservationRepository({db,auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk})
  const outcomes=await Promise.allSettled([stock.reservation({productId:'pos',variantId:'v',sourceType:'Order',sourceId:'competing-pos',quantity:'2'},'competing-pos'),customer().service.submit(input('competing-guest'))])
  assert.ok(outcomes.some(row=>row.status==='fulfilled'))
  assert.notEqual(outcomes.every(row=>row.status==='fulfilled'),true)
  const balance=(await sdk.getDoc(ref(db,'stock_balances',scope))).data(),book=(await sdk.getDoc(ref(db,'public_checkout_book','main'))).data()
  assert.ok(Number(balance.reserved)+(book.cursors[scope] || 0)<=2)
  assert.equal(balance.onHand,'2')
})
