import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {createPosCatalog} from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import {createStockLedger} from '../../BelleLocal POS app/functions/src/pos/stock-ledger.js'
import {createShopStock} from '../../BelleLocal POS app/functions/src/online-shop/stock.js'
import {normalizeProduct} from '../../BelleLocal POS app/functions/src/online-shop/domain.js'

if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Variant tests require isolated local Auth/Firestore emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url))
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
initializeApp({projectId:'demo-belle-online'})
const db=getFirestore(),auth=getAuth(),catalog=createPosCatalog({db}),ledger=createStockLedger({db})
const base='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
async function token(uid,email){
  try{await auth.createUser({uid,email,password:'Local-test-only-123!'})}catch(error){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(error.code))throw error}
  const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})})
  assert.equal(response.status,200);return (await response.json()).idToken
}
async function http(path,method='GET',body,owner){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer '+owner}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
  return {status:response.status,data:response.status===204?null:await response.json()}
}
const tree={levels:[{id:'color',label:'Color'},{id:'size',label:'Size'}],values:[{id:'brown',label:'Brown',level:0},{id:'black',label:'Black',level:0},{id:'small',label:'Small',level:1},{id:'large',label:'Large',level:1}]}
const path=(color='brown',size='small')=>[{level:1,label:'Untrusted size',valueId:size,value:'Untrusted value'},{level:0,label:'Untrusted color',valueId:color,value:'Untrusted value'}]

test('Retails variant HTTP contracts canonicalize paths, retain PATCH naming, enforce owner access, uniqueness and DELETE status',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example')
  assert.equal((await http('variants')).status,401)
  assert.equal((await http('variants','GET',undefined,other)).status,403)
  const name='Variant HTTP '+randomUUID(),sku=randomUUID()
  const created=await http('products','POST',{name,price:200,cost:100,optionTree:tree},owner)
  assert.equal(created.status,201);const productId=created.data.product.id,url='products/'+productId+'/variants'
  assert.equal((await http(url,'POST',{optionPath:[path()[0]]},owner)).status,400)
  assert.equal((await http(url,'POST',{optionPath:path('missing')},owner)).status,400)
  assert.equal((await http(url,'POST',{optionPath:path(),price:2_147_483_648},owner)).status,400)
  const first=await http(url,'POST',{optionPath:path(),sku,option1:'Explicit color',price:0,cost:0},owner)
  assert.equal(first.status,201);const variant=first.data.variant
  assert.equal(variant.name,'Brown / Small');assert.equal(variant.option1,'Explicit color')
  assert.equal(variant.variantSignature,'0:brown|1:small');assert.equal(variant.isDefault,false)
  assert.deepEqual(variant.optionPath,[{level:0,label:'Color',valueId:'brown',value:'Brown'},{level:1,label:'Size',valueId:'small',value:'Small'}])
  assert.equal((await http(url,'POST',{optionPath:path()},owner)).status,400)
  assert.equal((await http(url,'POST',{optionPath:path('black'),sku},owner)).status,409)
  const updated=await http(url+'/'+variant.id,'PATCH',{optionPath:path('black'),option1:'Ignored override'},owner)
  assert.equal(updated.status,200);assert.equal(updated.data.variant.name,'Brown / Small')
  assert.equal(updated.data.variant.option1,'Black');assert.equal(updated.data.variant.sku,sku)
  const named=await http(url+'/'+variant.id,'PATCH',{name:'Explicit name',isActive:false},owner)
  assert.equal(named.data.variant.name,'Explicit name')
  const inactive=await http('variants?search='+sku+'&status=inactive','GET',undefined,owner)
  assert.equal(inactive.data.totalCount,1);assert.equal(inactive.data.variants[0].product.name,name)
  assert.deepEqual(inactive.data.variants[0].balances,[])
  assert.equal((await http('variants?search='+sku,'GET',undefined,owner)).data.totalCount,0)
  assert.equal((await http('variants?pageSize=26','GET',undefined,owner)).status,400)
  assert.equal((await http(url+'/'+variant.id,'DELETE',undefined,other)).status,403)
  assert.equal((await http(url+'/'+variant.id,'DELETE',undefined,owner)).status,204)
  assert.equal((await http(url+'/'+variant.id,'PATCH',{name:'Gone'},owner)).status,404)
  assert.equal((await http('products/'+productId,'GET',undefined,owner)).data.product.variants.length,0)
})

test('variant contention, scoped SKUs, stock archive and binding evidence preserve identities and immutable legacy/source records',async()=>{
  const shop='variants-'+randomUUID(),table=(name)=>db.collection(`onlineShopV2/${shop}/${name}`)
  const legacy=db.doc('users/demo-owner/orders/variant-legacy-'+randomUUID()),original={paymentStatus:'unpaid',fulfillmentStatus:'reserved',total:34500}
  await legacy.set(original)
  const product=await catalog.create(shop,{name:'Parent search',price:200,cost:100,units:[{name:'Piece',isBase:true,conversionFactor:1}],optionTree:tree,capabilities:{'sale.test':true}},'demo-owner',randomUUID())
  const variants=catalog.variants
  const competitors=await Promise.allSettled([1,2,3].map(()=>variants.save(shop,product.id,null,{optionPath:path(),sku:'shared'},'demo-owner')))
  assert.equal(competitors.filter((entry)=>entry.status==='fulfilled').length,1)
  for(const entry of competitors.filter((entry)=>entry.status==='rejected'))assert.equal(entry.reason.status,400,entry.reason.stack)
  const brown=competitors.find((entry)=>entry.status==='fulfilled').value.variant
  const black=(await variants.save(shop,product.id,null,{optionPath:path('black'),sku:'other',price:150},'demo-owner')).variant
  await assert.rejects(variants.save(shop,product.id,black.id,{optionPath:path()},'demo-owner'),{status:400})
  const sameSku=await Promise.allSettled(['brown','black'].map((color)=>variants.save(shop,product.id,null,{optionPath:path(color,'large'),sku:'competing-sku'},'demo-owner')))
  assert.equal(sameSku.filter((entry)=>entry.status==='fulfilled').length,1)
  assert.equal(sameSku.find((entry)=>entry.status==='rejected').reason.status,409)
  const otherProduct=await catalog.create(shop,{name:'Other',price:100,cost:50},'demo-owner',randomUUID())
  const defaultVariant=(await variants.save(shop,otherProduct.id,null,{sku:'shared'},'demo-owner')).variant
  assert.equal(defaultVariant.name,'Default');assert.equal(defaultVariant.price,null)
  assert.equal(defaultVariant.variantSignature,'__default')
  await assert.rejects(variants.save(shop,otherProduct.id,null,{optionPath:path()},'demo-owner'),{status:400})
  const receipt=await ledger.receive(shop,{productId:product.id,variantId:brown.id,quantity:2.5,unitCost:100},'demo-owner',randomUUID())
  const movementRef=table('stock_movements').doc(receipt.inventoryBatch.id),movement=(await movementRef.get()).data()
  const hold=await ledger.reservation(shop,{productId:product.id,variantId:brown.id,quantity:1,sourceType:'PosOrder',sourceId:'held'},'demo-owner',randomUUID())
  let located=await variants.list(shop,{location:'main',search:'parent',capability:'sale.test'})
  assert.equal(located.totalCount,1);assert.equal(located.variants[0].id,brown.id);assert.equal(located.variants[0].balances[0].reserved,'1')
  await table('pos_products').doc(product.id).update({isActive:false})
  assert.equal((await variants.list(shop,{search:'parent'})).totalCount,3,'Parent activity does not filter active variants in the reference route')
  await table('pos_products').doc(product.id).update({isActive:true})
  const deleted=await variants.remove(shop,product.id,brown.id,'demo-owner')
  assert.equal(deleted.archived,true);assert.equal(deleted.variant.isActive,false)
  await assert.rejects(variants.save(shop,product.id,null,{optionPath:path()},'demo-owner'),{status:400})
  await assert.rejects(ledger.receive(shop,{productId:product.id,variantId:brown.id,quantity:1,unitCost:100},'demo-owner',randomUUID()),{status:400})
  const released=await ledger.reservation(shop,{productId:product.id,variantId:brown.id,action:'release',sourceType:'PosOrder',sourceId:'held'},'demo-owner',randomUUID())
  assert.equal(released.id,hold.id);assert.equal(released.status,'RELEASED')
  assert.deepEqual((await movementRef.get()).data(),movement)
  assert.equal((await variants.list(shop,{status:'inactive',location:'main'})).variants[0].id,brown.id)
  const sorted=await variants.list(shop,{status:'all',sort:'price',direction:'asc'})
  assert.equal(sorted.variants[0].id,black.id,'Nullable price sorts after actual price ascending')
  assert.equal((await variants.list(shop,{status:'all',sort:'price',direction:'desc'})).variants.at(-1).id,black.id)
  assert.equal(await variants.remove(shop,product.id,black.id,'demo-owner'),null)
  assert.equal((await catalog.get(shop,product.id)).product.variants.some((entry)=>entry.id===black.id),false)

  const publicProduct=normalizeProduct({name:'Bound variant',slug:'bound-variant',status:'published',variants:[{sku:'public',color:'Brown',size:'1',price:200,active:true}]},null,shop)
  await table('products').doc(publicProduct.id).set(publicProduct)
  const stock=createShopStock({db}),binding=await stock.bind(shop,{public_product_id:publicProduct.id,public_variant_id:publicProduct.variants[0].id,pos_product_id:otherProduct.id,pos_variant_id:defaultVariant.id},'demo-owner')
  const boundArchive=await variants.remove(shop,otherProduct.id,defaultVariant.id,'demo-owner')
  assert.equal(boundArchive.archived,true,'Binding-only variants must retain their identities')
  assert.deepEqual((await table('stock_bindings').doc(publicProduct.variants[0].id).get()).data(),binding)
  assert.equal((await stock.project(shop,[publicProduct]))[0].variants[0].available,0)
  assert.deepEqual((await legacy.get()).data(),original)
  const audit=(await table('pos_audit').get()).docs.map((row)=>row.data())
  assert.ok(audit.some((event)=>event.action==='variant.archive'&&event.entityId===brown.id))
  assert.ok(audit.some((event)=>event.action==='variant.delete'&&event.entityId===black.id))
  // A cancelled sale still counts as variant history in the source route.
  const cancelledProduct=await catalog.create(shop,{name:'Cancelled history',price:100,cost:50},'demo-owner',randomUUID())
  const cancelledVariant=(await variants.save(shop,cancelledProduct.id,null,{},'demo-owner')).variant
  await table('pos_orders').doc('cancelled-fixture').set({cancelledAt:new Date().toISOString(),items:[{productId:cancelledProduct.id,variantId:cancelledVariant.id}]})
  assert.equal((await variants.remove(shop,cancelledProduct.id,cancelledVariant.id,'demo-owner')).archived,true)
  // A receipt racing a physical deletion may either win and force archive,
  // or lose because the identity disappeared. It must never leave orphan stock.
  for(let round=0;round<3;round++){
    const raceProduct=await catalog.create(shop,{name:'Archive race '+round,price:100,cost:50},'demo-owner',randomUUID())
    const raceVariant=(await variants.save(shop,raceProduct.id,null,{},'demo-owner')).variant
    const race=await Promise.allSettled([
      ledger.receive(shop,{productId:raceProduct.id,variantId:raceVariant.id,quantity:1,unitCost:50},'demo-owner',randomUUID()),
      variants.remove(shop,raceProduct.id,raceVariant.id,'demo-owner'),
    ])
    assert.equal(race[1].status,'fulfilled',race[1].reason?.stack)
    const remaining=(await catalog.get(shop,raceProduct.id)).product
    if(race[0].status==='fulfilled'){
      assert.equal(race[1].value.archived,true);assert.equal(remaining.variants[0].id,raceVariant.id)
      assert.equal(remaining.currentStock,1)
    }else{
      assert.equal(race[0].reason.status,400,race[0].reason.stack);assert.equal(race[1].value,null)
      assert.equal(remaining.variants.length,0);assert.equal(remaining.currentStock,0)
    }
  }
  for(let round=0;round<2;round++){
    const raceProduct=await catalog.create(shop,{name:'Binding race '+round,price:100,cost:50},'demo-owner',randomUUID())
    const raceVariant=(await variants.save(shop,raceProduct.id,null,{},'demo-owner')).variant
    const publicRace=normalizeProduct({name:'Binding race',slug:'binding-race-'+round,status:'published',variants:[{sku:'binding-'+round,color:'Brown',size:'1',price:100,active:true}]},null,shop)
    await table('products').doc(publicRace.id).set(publicRace)
    const raced=await Promise.allSettled([
      stock.bind(shop,{public_product_id:publicRace.id,public_variant_id:publicRace.variants[0].id,pos_product_id:raceProduct.id,pos_variant_id:raceVariant.id},'demo-owner'),
      variants.remove(shop,raceProduct.id,raceVariant.id,'demo-owner'),
    ])
    assert.equal(raced[1].status,'fulfilled',raced[1].reason?.stack)
    const bindingDoc=await table('stock_bindings').doc(publicRace.variants[0].id).get()
    const remaining=(await catalog.get(shop,raceProduct.id)).product.variants
    if(raced[0].status==='fulfilled'){
      assert.equal(bindingDoc.exists,true);assert.equal(raced[1].value.archived,true)
      assert.equal(remaining[0].id,raceVariant.id)
    }else{
      assert.equal(raced[0].reason.status,400,raced[0].reason.stack)
      assert.equal(bindingDoc.exists,false);assert.equal(remaining.length,0)
    }
  }
})
