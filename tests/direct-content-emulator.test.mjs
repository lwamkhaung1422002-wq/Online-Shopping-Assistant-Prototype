import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { createContentRepository } from '../../BelleLocal POS app/src/features/firebase-direct/content-repository.js'
import { MAIN_OWNER_UID } from '../../BelleLocal POS app/src/features/firebase-direct/content-model.js'
import { postFromPosProduct } from '../../BelleLocal POS app/src/features/firebase-direct/content-model.js'
import { originalPresentation } from '../../BelleLocal POS app/src/features/firebase-direct/original-presentation.js'
import { createDirectCatalog } from '../dashboard/src/services/direct-catalog.js'

const require=createRequire(new URL('../../BelleLocal POS app/package.json',import.meta.url))
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing')
const sdk=require('firebase/firestore')
if(process.env.DIRECT_FIRESTORE_EMULATOR!=='127.0.0.1:8088')throw Error('Direct CMS tests require the explicitly selected isolated emulator.')
const rules=await readFile(new URL('../../BelleLocal POS app/config/firebase/firestore.direct.rules',import.meta.url),'utf8')
const environment=await initializeTestEnvironment({projectId:'demo-belle-direct',firestore:{host:'127.0.0.1',port:8088,rules}})
const root='onlineShopV2/belle-online',post={id:'post',shop_id:'belle-online',name:'Elegence',slug:'elegence',description:'',status:'published',category_id:null,size_guide_id:null,featured:false,display_order:0,created_at:'2026-07-23',updated_at:'2026-07-23',images:[],memberships:[],variants:[{id:'variant',color:'Brown',size:'Size 1',sku:'belle-brown',price:34500,active:true,on_hand:124,reserved:0}],private_cost:12000}
test.after(()=>environment.cleanup())
const fixture=async()=>{await environment.clearFirestore();await environment.withSecurityRulesDisabled(async context=>{
  const db=context.firestore()
  await sdk.setDoc(sdk.doc(db,`${root}/products/post`),post)
  await sdk.setDoc(sdk.doc(db,`users/${MAIN_OWNER_UID}/orders/original`),{total:34500,paymentStatus:'unpaid'})
  await sdk.setDoc(sdk.doc(db,`${root}/stock_balances/balance`),{onHand:'124',reserved:'0',value:'private-cost'})
})}

test('actual browser SDK transaction saves content/public projection, hide removes guest access, original and balance stay unchanged',async()=>{
  await fixture()
  const db=environment.authenticatedContext(MAIN_OWNER_UID).firestore(),guest=environment.unauthenticatedContext().firestore()
  const repo=createContentRepository({db,auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk,now:()=> '2026-10-14'})
  await repo.saveProduct({...post,name:'Edited title',collection_ids:[]})
  const projected=(await assertSucceeds(sdk.getDoc(sdk.doc(guest,`${root}/public_products/post`)))).data()
  assert.equal(projected.name,'Edited title');assert.ok(!('private_cost' in projected));assert.ok(!('sku' in projected.variants[0]))
  await assertFails(sdk.getDoc(sdk.doc(guest,`${root}/products/post`)))
  await assertFails(sdk.getDoc(sdk.doc(guest,`${root}/stock_balances/balance`)))
  await repo.saveProduct({...post,status:'hidden',collection_ids:[]})
  await assertFails(sdk.getDoc(sdk.doc(guest,`${root}/public_products/post`)))
  assert.deepEqual((await sdk.getDoc(sdk.doc(db,`${root}/stock_balances/balance`))).data(),{onHand:'124',reserved:'0',value:'private-cost'})
  assert.deepEqual((await sdk.getDoc(sdk.doc(db,`users/${MAIN_OWNER_UID}/orders/original`))).data(),{total:34500,paymentStatus:'unpaid'})
  await assertFails(sdk.updateDoc(sdk.doc(db,`users/${MAIN_OWNER_UID}/orders/original`),{paymentStatus:'paid'}))
})

test('concurrent post edits cannot claim the same slug; loser leaves no partial public projection',async()=>{
  await fixture()
  await environment.withSecurityRulesDisabled(context=>sdk.setDoc(sdk.doc(context.firestore(),`${root}/products/another`),{...post,id:'another',slug:'another'}))
  const db=environment.authenticatedContext(MAIN_OWNER_UID).firestore(),repo=createContentRepository({db,auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk})
  const results=await Promise.allSettled([repo.saveProduct({...post,slug:'shared',collection_ids:[]}),repo.saveProduct({...post,id:'another',slug:'shared',collection_ids:[]})])
  assert.equal(results.filter(row=>row.status==='fulfilled').length,1)
  const claim=(await sdk.getDoc(sdk.doc(db,`${root}/content_slugs/shared`))).data()
  const loser=claim.product_id==='post'?'another':'post'
  await environment.withSecurityRulesDisabled(async context=>assert.equal((await sdk.getDoc(sdk.doc(context.firestore(),`${root}/public_products/${loser}`))).exists(),false))
})

test('content owner cannot mutate business stock through draft rules; strangers cannot edit posts or originals',async()=>{
  await fixture()
  const owner=environment.authenticatedContext(MAIN_OWNER_UID).firestore(),stranger=environment.authenticatedContext('another-user').firestore()
  await assertFails(sdk.updateDoc(sdk.doc(owner,`${root}/stock_balances/balance`),{onHand:'1000'}))
  await assertFails(sdk.setDoc(sdk.doc(stranger,`${root}/products/post`),post))
  await assertFails(sdk.getDoc(sdk.doc(stranger,`users/${MAIN_OWNER_UID}/orders/original`)))
  await assertFails(sdk.setDoc(sdk.doc(owner,`${root}/public_products/post`),{...post,private_cost:123}))
  const repo=createContentRepository({db:owner,auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk})
  const src='https://res.cloudinary.com/belle/image/upload/v1/brown.webp'
  await repo.saveGallery('post',[{id:'photo',src,is_cover:true,color:'Brown',alt:'Brown'}])
  assert.equal((await sdk.getDoc(sdk.doc(owner,`${root}/public_products/post`))).data().images[0].src,src)
  await repo.saveRecord('store_settings',{store_name:'Belle',hero_title:'New collection',phone:'09666655928',checkout_enabled:true,delivery_fee:100000})
  const settings=(await sdk.getDoc(sdk.doc(owner,`${root}/store_settings/main`))).data()
  assert.ok(!('checkout_enabled' in settings));assert.ok(!('delivery_fee' in settings))
})

test('new POS-backed post creates only content/bindings; two requests cannot publish a second post for the same POS product',async()=>{
  await fixture()
  const source={id:'pos-source',name:'New dress',sku:'source-sku',isActive:true,price:39500,cost:12000,variants:[{id:'pos-choice',sku:'choice-sku',price:39500,cost:12000,isActive:true,optionPath:[{level:0,value:'Size 2'},{level:1,value:'Pink'}]}]}
  await environment.withSecurityRulesDisabled(context=>sdk.setDoc(sdk.doc(context.firestore(),`${root}/pos_products/${source.id}`),source))
  const db=environment.authenticatedContext(MAIN_OWNER_UID).firestore(),repo=createContentRepository({db,auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk})
  const request=id=>({...postFromPosProduct(source,id,'2026-10-14'),collection_ids:[],status:'published'})
  await assert.rejects(repo.saveProduct({...request('collision'),slug:'elegence'}),{status:409})
  const results=await Promise.allSettled([repo.saveProduct(request('first')),repo.saveProduct(request('second'))])
  assert.equal(results.filter(value=>value.status==='fulfilled').length,1)
  const winner=results[0].status==='fulfilled'?'first':'second',loser=winner==='first'?'second':'first'
  const binding=(await sdk.getDoc(sdk.doc(db,`${root}/stock_bindings/pos-choice`))).data()
  assert.equal(binding.public_product_id,winner);assert.equal(binding.pos_product_id,source.id);assert.match(binding.scope_key,/^[a-f0-9]{64}$/)
  const created=(await sdk.getDoc(sdk.doc(db,`${root}/products/${winner}`))).data()
  assert.equal(created.variants[0].price,39500);assert.equal(created.variants[0].on_hand,0)
  assert.equal((await sdk.getDoc(sdk.doc(db,`${root}/products/${loser}`))).exists(),false)
  assert.deepEqual((await sdk.getDoc(sdk.doc(db,`${root}/stock_balances/balance`))).data(),{onHand:'124',reserved:'0',value:'private-cost'})
  assert.deepEqual((await sdk.getDoc(sdk.doc(db,`${root}/pos_products/${source.id}`))).data(),source)
  await environment.withSecurityRulesDisabled(context=>sdk.updateDoc(sdk.doc(context.firestore(),`${root}/pos_products/${source.id}`),{variants:[{...source.variants[0],price:45000}]}))
  const refreshed=await repo.getProduct(winner)
  assert.equal(refreshed.variants[0].price,45000)
  await assert.rejects(repo.saveProduct({...request(winner),name:'Stale edit'}),{status:409})
  await repo.saveProduct({...refreshed,name:'Fresh edit',collection_ids:[]})
  assert.equal((await sdk.getDoc(sdk.doc(db,`${root}/public_products/${winner}`))).data().variants[0].price,45000)
})

test('taxonomy delete refuses assigned records and removes both views after unassignment without deleting any business records',async()=>{
  await fixture()
  const db=environment.authenticatedContext(MAIN_OWNER_UID).firestore(),repo=createContentRepository({db,auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk})
  await repo.saveRecord('categories',{id:'category',name:'Dresses',display_order:0})
  await repo.saveProduct({...post,category_id:'category',collection_ids:[]})
  await assert.rejects(repo.deleteRecord('categories','category'),{status:409})
  await repo.saveProduct({...post,category_id:null,collection_ids:[]})
  await repo.deleteRecord('categories','category')
  for(const table of ['categories','public_categories'])assert.equal((await sdk.getDoc(sdk.doc(db,`${root}/${table}/category`))).exists(),false)
  assert.equal((await sdk.getDoc(sdk.doc(db,`${root}/products/post`))).exists(),true)
  assert.equal((await sdk.getDoc(sdk.doc(db,`users/${MAIN_OWNER_UID}/orders/original`))).data().total,34500)
})

test('original presentation restores real gallery/guide, is repeat-safe and retains owner edits without touching stock or source records',async()=>{
  await fixture()
  const id=Object.keys(originalPresentation)[0],original=originalPresentation[id],db=environment.authenticatedContext(MAIN_OWNER_UID).firestore()
  await environment.withSecurityRulesDisabled(context=>sdk.setDoc(sdk.doc(context.firestore(),`${root}/products/${id}`),{...post,id,name:original.main_name,slug:id,images:[],size_guide_id:null}))
  const repo=createContentRepository({db,auth:{currentUser:{uid:MAIN_OWNER_UID}},sdk})
  const restored=await repo.restoreOriginalPresentation(id)
  assert.equal(restored.images.length,6);assert.equal(restored.size_guide_id,original.guide.id)
  assert.equal((await sdk.getDoc(sdk.doc(db,`${root}/public_size_guides/${original.guide.id}`))).data().name,original.guide.name)
  await environment.withSecurityRulesDisabled(context=>sdk.setDoc(sdk.doc(context.firestore(),`${root}/public_stock/variant`),{available:2}))
  const guest=environment.unauthenticatedContext().firestore(),catalog=createDirectCatalog({db:guest,sdk})
  const publicRows=await catalog('catalog')
  assert.equal(publicRows.length,1);assert.equal(publicRows[0].images.length,6);assert.equal(publicRows[0].guide.name,original.guide.name)
  assert.equal(publicRows[0].variants[0].available,2);assert.ok(!('private_cost' in publicRows[0]))
  await repo.restoreOriginalPresentation(id)
  assert.deepEqual((await sdk.getDoc(sdk.doc(db,`${root}/products/${id}`))).data().images,restored.images)
  const custom=[{id:'custom-photo',src:'https://res.cloudinary.com/belle/image/upload/custom.webp',is_cover:true,alt:'Owner edit',color:'Brown'}]
  await repo.saveGallery(id,custom)
  await repo.restoreOriginalPresentation(id)
  assert.equal((await sdk.getDoc(sdk.doc(db,`${root}/products/${id}`))).data().images[0].id,'custom-photo')
  assert.deepEqual((await sdk.getDoc(sdk.doc(db,`${root}/stock_balances/balance`))).data(),{onHand:'124',reserved:'0',value:'private-cost'})
  assert.equal((await sdk.getDoc(sdk.doc(db,`users/${MAIN_OWNER_UID}/orders/original`))).data().paymentStatus,'unpaid')
  await assert.rejects(repo.restoreOriginalPresentation('Long'),{status:409})
})
