import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { MAIN_OWNER_UID } from '../../BelleLocal POS app/src/features/firebase-direct/content-model.js'
import { directStockScope } from '../../BelleLocal POS app/src/features/firebase-direct/availability-model.js'
import { createAvailabilityRepository } from '../../BelleLocal POS app/src/features/firebase-direct/availability-repository.js'
import { createDirectCatalog } from '../dashboard/src/services/direct-catalog.js'

const require=createRequire(new URL('../../BelleLocal POS app/package.json',import.meta.url)),sdk=require('firebase/firestore')
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing')
if(process.env.DIRECT_FIRESTORE_EMULATOR!=='127.0.0.1:8088')throw Error('Stock tests require the explicit isolated emulator.')
const environment=await initializeTestEnvironment({projectId:'demo-belle-direct-stock',firestore:{host:'127.0.0.1',port:8088,rules:await readFile(new URL('../../BelleLocal POS app/config/firebase/firestore.direct.rules',import.meta.url),'utf8')}})
test.after(()=>environment.cleanup())
const root='onlineShopV2/belle-online',owner=()=>environment.authenticatedContext(MAIN_OWNER_UID).firestore()
async function fixture(count=1,cutover=true){
  await environment.clearFirestore()
  const ids=[]
  await environment.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(),batch=sdk.writeBatch(db),variants=[]
    batch.set(sdk.doc(db,`${root}/direct_runtime/main`),{stock_authority:'ledger-v2',backend_writers_stopped:cutover,original_writers_stopped:true})
    for(let index=0;index<count;index++){
      const variantId=`variant-${index}`,choiceId=`choice-${index}`,scope=await directStockScope('pos',variantId),quantity=count===20?(index===0?10:6):2
      ids.push({variantId,choiceId,scope})
      variants.push({id:variantId,price:34500+index,isActive:true,cost:12000})
      batch.set(sdk.doc(db,`${root}/stock_balances/${scope}`),{productId:'pos',variantId,onHand:String(quantity),reserved:'0',sourceLedger:{onHand:'999',reserved:'0'},cost:12000})
      batch.set(sdk.doc(db,`${root}/stock_bindings/${choiceId}`),{id:choiceId,public_product_id:'post',public_variant_id:choiceId,pos_product_id:'pos',pos_variant_id:variantId,scope_key:scope})
    }
    batch.set(sdk.doc(db,`${root}/pos_products/pos`),{id:'pos',name:'Demo dress',trackingMode:'NONE',isActive:true,cost:12000,variants})
    const post={id:'post',name:'Demo dress',slug:'demo-dress',description:'',status:'published',featured:false,display_order:0,created_at:'2026-10-14',category_id:null,size_guide_id:null,images:[],memberships:[],variants:ids.map(({choiceId},index)=>({id:choiceId,color:'Brown',size:`Size ${index}`,price:34500+index,active:true,on_hand:999,reserved:0}))}
    batch.set(sdk.doc(db,`${root}/products/post`),post)
    batch.set(sdk.doc(db,`${root}/public_products/post`),{...post,variants:post.variants.map(({on_hand:_on_hand,reserved:_reserved,...row})=>row)})
    batch.set(sdk.doc(db,`users/${MAIN_OWNER_UID}/orders/original`),{total:34500,paymentStatus:'unpaid'})
    await batch.commit()
  })
  return ids
}

test('SDK publishes twenty shared availability views/124 units atomically without grants or source changes, public cannot mutate/read private stock',async()=>{
  const ids=await fixture(20),db=owner(),guest=environment.unauthenticatedContext().firestore(),repo=createAvailabilityRepository({db,auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk})
  const before=(await sdk.getDoc(sdk.doc(db,`${root}/stock_balances/${ids[0].scope}`))).data()
  assert.deepEqual(await repo.publish(),{variants:20,available:124,stockChanged:false})
  const publicRows=(await sdk.getDocs(sdk.collection(guest,`${root}/public_stock`))).docs
  assert.equal(publicRows.length,20);assert.equal(publicRows.reduce((sum,row)=>sum+row.data().available,0),124)
  assert.ok(publicRows.every(row=>!('cost' in row.data())&&!('sourceLedger' in row.data())))
  assert.deepEqual((await sdk.getDoc(sdk.doc(db,`${root}/stock_balances/${ids[0].scope}`))).data(),before)
  assert.equal((await sdk.getDoc(sdk.doc(db,`users/${MAIN_OWNER_UID}/orders/original`))).data().paymentStatus,'unpaid')
  await assertFails(sdk.getDoc(sdk.doc(guest,`${root}/stock_balances/${ids[0].scope}`)))
  await assertFails(sdk.updateDoc(sdk.doc(guest,`${root}/public_stock/${ids[0].choiceId}`),{available:9999}))
  const catalog=createDirectCatalog({db:guest,sdk}),posts=await catalog('catalog')
  assert.equal(posts[0].variants.reduce((sum,row)=>sum+row.available,0),124)
})

test('publication refuses an unfinished cutover before collection scans and rolls back malformed scopes without partial public data',async()=>{
  const ids=await fixture(1,false),db=owner();let scans=0
  const counted={...sdk,getDocsFromServer:ref=>{scans++;return sdk.getDocsFromServer(ref)}}
  const repo=createAvailabilityRepository({db,auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk:counted})
  await assert.rejects(repo.publish(),{status:409});assert.equal(scans,0)
  await environment.withSecurityRulesDisabled(async context=>{
    const fixtureDb=context.firestore()
    await sdk.updateDoc(sdk.doc(fixtureDb,`${root}/direct_runtime/main`),{backend_writers_stopped:true})
    await sdk.updateDoc(sdk.doc(fixtureDb,`${root}/stock_balances/${ids[0].scope}`),{reserved:'3'})
  })
  await assert.rejects(repo.publish(),{status:409})
  assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/public_stock`))).size,0)
})

test('source-registry change during snapshot selection forces a fresh bounded scan and never publishes stale availability',async()=>{
  const [identity]=await fixture(),db=owner();let changed=false,scans=0
  const coordinated={...sdk,getDocsFromServer:ref=>{scans++;return sdk.getDocsFromServer(ref)},runTransaction:async(db,action)=>{
    if(!changed){changed=true;await environment.withSecurityRulesDisabled(async context=>{
      const fixtureDb=context.firestore(),batch=sdk.writeBatch(fixtureDb)
      batch.update(sdk.doc(fixtureDb,`${root}/stock_balances/${identity.scope}`),{reserved:'1'})
      batch.set(sdk.doc(fixtureDb,`${root}/direct_stock_meta/main`),{version:1})
      await batch.commit()
    })}
    return sdk.runTransaction(db,action)
  }}
  const repo=createAvailabilityRepository({db,auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk:coordinated})
  assert.equal((await repo.publish()).available,1);assert.equal(scans,20)
  assert.equal((await sdk.getDoc(sdk.doc(db,`${root}/public_stock/${identity.choiceId}`))).data().source_revision,2)
  assert.equal((await sdk.getDoc(sdk.doc(db,`${root}/stock_balances/${identity.scope}`))).data().reserved,'1')
})
