import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeContentPost, normalizeLinkedGallery, projectPublicContent, publicImageUrl, postFromPosProduct } from '../../BelleLocal POS app/src/features/firebase-direct/content-model.js'
import { originalPresentation, originalAssetFiles } from '../../BelleLocal POS app/src/features/firebase-direct/original-presentation.js'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createDirectCatalog } from '../dashboard/src/services/direct-catalog.js'
import { validateDashboardRuntime } from '../dashboard/shared/runtime.js'

const post = { id: 'post', name: 'Elegence', slug: 'elegence', description: '', status: 'published', featured: false,
  display_order: 0, created_at: '2026-07-23', updated_at: '2026-07-23', images: [], memberships: [],
  private_cost: 12000, supplier: 'private', variants: [{ id: 'variant', color: 'Brown', size: 'Size 1', sku: 'private-sku', price: 34500, active: true, on_hand: 124, reserved: 0, cost: 12000 }] }

test('CMS edits preserve POS price, stock and variant identity and reject changing them',()=>{
  const changed=normalizeContentPost({...post,name:'New title',status:'hidden',collection_ids:[]},post,'2026-10-14')
  assert.equal(changed.status,'hidden');assert.equal(changed.variants[0].on_hand,124);assert.equal(changed.variants[0].price,34500)
  for(const edit of [{variants:[]},{variants:[{...post.variants[0],price:1}]},{variants:[{...post.variants[0],id:'another'}]},{variants:[{...post.variants[0],size:'another'}]}])assert.throws(()=>normalizeContentPost({...post,...edit},post,'stamp'),{status:409})
  assert.equal(post.name,'Elegence')
})

test('public content has no private cost, supplier, SKU or copied stock counters',()=>{
  const publicPost=projectPublicContent(post)
  assert.equal(publicPost.name,'Elegence');assert.equal(publicPost.variants[0].price,34500)
  for(const key of ['private_cost','supplier'])assert.ok(!(key in publicPost))
  for(const key of ['sku','cost','on_hand','reserved','available'])assert.ok(!(key in publicPost.variants[0]))
})

test('Cloudinary links preserve cover and ordering, reject duplicate/private/local/credential URLs',()=>{
  const src='https://res.cloudinary.com/belle/image/upload/v123/brown.webp'
  assert.equal(publicImageUrl(src),src)
  const images=normalizeLinkedGallery([{id:'photo',src,is_cover:true,alt:'Brown',color:'Brown',position:9}])
  assert.equal(images[0].position,0);assert.equal(images[0].src,src)
  assert.throws(()=>normalizeLinkedGallery([...images,{...images[0],id:'duplicate',is_cover:false}]))
  assert.throws(()=>normalizeLinkedGallery([{...images[0],is_cover:false}]))
  for(const value of ['http://res.cloudinary.com/belle/image/upload/a.webp','https://res.cloudinary.com.evil.example/belle/image/upload/a.webp','https://user:password@res.cloudinary.com/belle/image/upload/a.webp','http://127.0.0.1:5003/photo','https://res.cloudinary.com/belle/raw/upload/private.txt'])assert.throws(()=>publicImageUrl(value))
})

test('direct public catalogue reads only public projections and rejects absent authority instead of inventing stock',async()=>{
  const data=new Map([
    ['public_products',[{...projectPublicContent(post),private_cost:999}]],['public_categories',[]],['public_size_guides',[]],['public_stock',[{id:'variant',available:2,price:39500,cost:123}]],
  ]),requests=[]
  const sdk={collection:(_db,path)=>({table:path.split('/').at(-1)}),query:(ref)=>ref,where:()=>null,
    doc:(_db,path)=>({table:path.split('/').at(-2)}),getDoc:async ref=>({data:()=>data.get(ref.table)?.[0]}),
    getDocs:async ref=>{requests.push(ref.table);return {docs:(data.get(ref.table)||[]).map(value=>({id:value.id,data:()=>value}))}}}
  const read=createDirectCatalog({db:{},sdk})
  const products=await read('catalog')
  assert.equal(products[0].variants[0].available,2)
  assert.equal(products[0].variants[0].price,39500)
  assert.ok(!('private_cost' in products[0]));assert.ok(!('cost' in products[0].variants[0]))
  assert.ok(requests.every(table=>table.startsWith('public_')))
  data.set('public_stock',[])
  await assert.rejects(read('catalog'),/availability is not connected/)
  await assert.rejects(read('checkout',{items:[]}),/customer Firebase session is not connected/)
  data.set('public_stock',[{id:'variant',available:2,price:39500}])
  data.set('public_checkout_book',[{frame_id:'frame',checkout_enabled:true,quotes:{variant:{scope_key:'scope'}},cursors:{scope:1}}])
  data.set('public_checkout_frames',[{scopes:{scope:{capacity:2}}}])
  assert.equal((await read('catalog'))[0].variants[0].available,1)
})

test('direct dashboard configuration rejects HTTP coexistence, unrelated shops and production demo data',()=>{
  assert.deepEqual(validateDashboardRuntime({VITE_FIREBASE_DIRECT:'true'},'','pos-shop-owner','belle-online'),{mainLocal:false,useEmulator:false,directMode:true})
  assert.equal(validateDashboardRuntime({VITE_FIREBASE_DIRECT:'true',DEV:true},'','demo-belle-direct','belle-online').useEmulator,true)
  for(const args of [
    [{VITE_FIREBASE_DIRECT:'true'},'http://127.0.0.1:5003','pos-shop-owner','belle-online'],
    [{VITE_FIREBASE_DIRECT:'true',VITE_MAIN_LOCAL:'true'},'','pos-shop-owner','belle-online'],
    [{VITE_FIREBASE_DIRECT:'true'},'','pos-shop-owner','another'],
    [{VITE_FIREBASE_DIRECT:'true'},'','demo-belle-direct','belle-online'],
  ])assert.throws(()=>validateDashboardRuntime(...args))
})

test('POS-backed post uses source variant prices/IDs, creates no stock and requires real size/color choices',()=>{
  const source={id:'pos',name:'Dress',isActive:true,cost:1,variants:[{id:'choice',sku:'choice',price:39500,optionPath:[{level:0,value:'Size 2'},{level:1,value:'Pink'}]}]}
  const draft=postFromPosProduct(source,'post-key','2026-10-14')
  assert.equal(draft.variants[0].id,'choice');assert.equal(draft.variants[0].price,39500);assert.equal(draft.variants[0].on_hand,0)
  assert.equal(draft.pos_product_id,'pos');assert.ok(!('cost' in draft))
  assert.throws(()=>postFromPosProduct({...source,isActive:false},'post-key','stamp'),{status:409})
  assert.throws(()=>postFromPosProduct({...source,variants:[{...source.variants[0],optionPath:[]}]},'post-key','stamp'),{status:409})
})

test('reviewed original media has three exact mappings, no Long/Sakura substitution, and copied bytes match the original hashes',async()=>{
  const plan=JSON.parse(await readFile(new URL('../docs/evidence/main-original-presentation-plan.json',import.meta.url),'utf8'))
  assert.equal(Object.keys(originalPresentation).length,3);assert.equal(Object.keys(originalAssetFiles).length,18)
  assert.ok(Object.values(originalPresentation).every(value=>value.main_name!=='Long'&&value.original_id!=='sakura'))
  for(const row of plan.products) {
    assert.equal(originalPresentation[row.id].guide.id,row.guide.id)
    for(const image of row.images) {
      const key=`${row.originalId}/${image.id}`,path=originalAssetFiles[key]
      const bytes=await readFile(new URL(`../../BelleLocal POS app/public${path}`,import.meta.url))
      assert.equal(createHash('sha256').update(bytes).digest('hex'),image.sha256)
    }
  }
  const gallery=normalizeLinkedGallery(originalPresentation[plan.products[0].id].images)
  assert.ok(gallery.every(value=>value.src===`asset:${value.asset_id}`))
  assert.throws(()=>normalizeLinkedGallery([{...gallery[0],asset_id:'sakura/wrong'}]))
})
