import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { createCheckoutFrameRepository } from '../../BelleLocal POS app/src/features/firebase-direct/checkout-frame-repository.js'
import { directStockScope } from '../../BelleLocal POS app/src/features/firebase-direct/availability-model.js'
import { MAIN_OWNER_UID } from '../../BelleLocal POS app/src/features/firebase-direct/content-model.js'
import { digest } from '../../BelleLocal POS app/src/shared/pos-domain/mutation.js'
const require=createRequire(new URL('../../BelleLocal POS app/package.json',import.meta.url)),sdk=require('firebase/firestore')
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing')
if(process.env.DIRECT_FIRESTORE_EMULATOR!=='127.0.0.1:8088')throw Error('Use the isolated direct emulator.')
const env=await initializeTestEnvironment({projectId:'demo-belle-direct-checkout-frame',firestore:{host:'127.0.0.1',port:8088,rules:await readFile(new URL('../../BelleLocal POS app/config/firebase/firestore.direct.rules',import.meta.url),'utf8')}})
test.after(()=>env.cleanup())
const root='onlineShopV2/belle-online',scope=await directStockScope('pos','v'),ref=(db,table,id)=>sdk.doc(db,`${root}/${table}/${id}`),owner=()=>env.authenticatedContext(MAIN_OWNER_UID).firestore()
async function fixture(enabled=true){await env.clearFirestore();await env.withSecurityRulesDisabled(async context=>{const db=context.firestore(),batch=sdk.writeBatch(db)
  batch.set(ref(db,'direct_runtime','main'),{stock_authority:'ledger-v2',backend_writers_stopped:enabled,original_writers_stopped:true})
  batch.set(ref(db,'pos_products','pos'),{id:'pos',trackingMode:'NONE',variants:[{id:'v',price:34500}]})
  batch.set(ref(db,'stock_balances',scope),{productId:'pos',variantId:'v',onHand:'2',reserved:'0',version:1})
  batch.set(ref(db,'stock_batches','batch'),{id:'batch',productId:'pos',variantId:'v',scopeKey:scope,baseQuantity:'2',reservedBaseQuantity:'0',physicalBaseQuantity:'2',heldBaseQuantity:'0',consumedBaseQuantity:'0',unitCost:12000,receivedAt:'2026-07-23'})
  batch.set(ref(db,'stock_bindings','choice'),{id:'choice',public_variant_id:'choice',public_product_id:'post',pos_product_id:'pos',pos_variant_id:'v',scope_key:scope})
  batch.set(ref(db,'products','post'),{id:'post',name:'Elegence',status:'published',variants:[{id:'choice',color:'Brown',size:'1',active:true}]})
  batch.set(sdk.doc(db,`users/${MAIN_OWNER_UID}/orders/original`),{total:34500,paymentStatus:'unpaid'})
  await batch.commit()})}
test('SDK publishes safe immutable frame/private basis once without changing stock/opening; basis/frame guest writes and private reads are denied',async()=>{
  await fixture();const db=owner(),publish=createCheckoutFrameRepository({db,auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk}).publish
  const before=(await sdk.getDoc(ref(db,'stock_batches','batch'))).data(),result=await publish()
  assert.equal(result.stockChanged,false);assert.equal(result.checkoutEnabled,false);assert.equal(result.costBases,1)
  assert.deepEqual((await sdk.getDoc(ref(db,'stock_batches','batch'))).data(),before)
  assert.equal((await sdk.getDoc(ref(db,'stock_balances',scope))).data().onHand,'2')
  const guest=env.unauthenticatedContext().firestore(),frame=(await sdk.getDoc(ref(guest,'public_checkout_frames',result.frameId))).data(),book=(await sdk.getDoc(ref(guest,'public_checkout_book','main'))).data()
  assert.equal(frame.scopes[scope].capacity,2);assert.equal(book.quotes.choice.unit_price,34500)
  assert.equal(JSON.stringify({frame,book}).includes('unitCost'),false)
  const basis=frame.scopes[scope].runs[0].cost_basis_id
  const privateValue=(await sdk.getDoc(ref(db,'frozen_cost_bases',basis))).data(),{nonce,...plain}=privateValue
  assert.ok(nonce.length>=64);assert.notEqual(basis,digest(plain));assert.equal(basis,digest(privateValue));assert.equal(JSON.stringify({frame,book}).includes(nonce),false)
  await assertFails(sdk.getDoc(ref(guest,'frozen_cost_bases',basis)))
  await assertFails(sdk.updateDoc(ref(db,'frozen_cost_bases',basis),{unitCost:1}))
  await assertFails(sdk.updateDoc(ref(db,'public_checkout_frames',result.frameId),{scopes:{}}))
  await assertFails(sdk.updateDoc(ref(guest,'public_checkout_book','main'),{checkout_enabled:true}))
  assert.equal((await publish()).costBases,0)
  assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/frozen_cost_bases`))).size,1)
  assert.deepEqual((await sdk.getDoc(sdk.doc(db,`users/${MAIN_OWNER_UID}/orders/original`))).data(),{total:34500,paymentStatus:'unpaid'})
})
test('activation gate avoids scans; pending booked rights prevent another frame or accidental duplicate opening',async()=>{
  await fixture(false);const db=owner();let scans=0
  const denied=createCheckoutFrameRepository({db,auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk:{...sdk,getDocsFromServer(ref){scans++;return sdk.getDocsFromServer(ref)}}})
  await assert.rejects(denied.publish(),{status:409});assert.equal(scans,0)
  await fixture();const service=createCheckoutFrameRepository({db,auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk});await service.publish()
  await env.withSecurityRulesDisabled(async context=>{await sdk.updateDoc(ref(context.firestore(),'public_checkout_book','main'),{cursors:{[scope]:1}})})
  await assert.rejects(service.publish(),{status:409})
  assert.equal((await sdk.getDoc(ref(db,'stock_balances',scope))).data().onHand,'2')
})
