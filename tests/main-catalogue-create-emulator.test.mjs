import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createMainSidecarFirestore } from '../../BelleLocal POS app/functions/src/main-local/firestore.js'
import { readLegacyCataloguePlan, buildLegacyCataloguePlan } from '../../BelleLocal POS app/functions/src/main-local/catalogue-plan.js'
import { createMainCatalogue, catalogueCreationInput } from '../../BelleLocal POS app/functions/src/main-local/catalogue-create.js'
import { createPosCatalog } from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import { createMainLocalHandler } from '../../BelleLocal POS app/functions/src/main-local/api.js'
import { digest } from '../../BelleLocal POS app/functions/src/pos/mutation.js'

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw Error('Catalogue creation tests require the isolated local Firestore emulator.')
const require = createRequire(new URL('../../BelleLocal POS app/functions/package.json', import.meta.url))
const { initializeApp, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
const owner = 'UXRbRF184gcohMkl4CdS0i0rdow2', shop = 'belle-online'

test('owner supplied price completes the actual four-design review without changing the original source proposal',async()=>{
  const plan=JSON.parse(await readFile(new URL('../docs/evidence/main-catalogue-plan.json',import.meta.url),'utf8'))
  const approved=JSON.parse(await readFile(new URL('../docs/evidence/main-catalogue-approved-review.json',import.meta.url),'utf8'))
  const original=structuredClone(plan)
  // Reproject the captured twenty actual choice labels through the corrected
  // flat-group planner; quantities here are fixtures, not live stock evidence.
  const variants=plan.products.flatMap(product=>product.variants)
  const stocks=variants.map((variant,index)=>({id:String(index),ref:{path:`users/${owner}/stocks/fixture-${index}`},data:()=>{const[size,color,type]=variant.legacy_variant_key.split('__');return{size,color,type,quantity:1,price:variant.suggestedCost,date:'2026-10-13'}}}))
  const current=buildLegacyCataloguePlan({source:{stocks,orders:[],snapshotHash:plan.snapshotHash},originals:[],effective:[]})
  const service=createMainCatalogue({db:{doc:()=>({get:async()=>({data:()=>undefined})})},readPlan:async()=>current,catalog:{}})
  const reviewed=await service.review()
  const pink=reviewed.products.flatMap(product=>product.variants).find(variant=>variant.legacy_variant_key==='Size 2__Pink__Short')
  assert.equal(pink.proposedPrice,null)
  assert.deepEqual(reviewed.initialPrices,[{key:pink.key,price:39500,basis:'owner-reviewed-initial-price',date:'2026-10-13'}])
  assert.equal(approved.request.prices.find(row=>row.key===pink.key).price,39500)
  const input=catalogueCreationInput(reviewed,approved.request)
  assert.equal(input.products.length,4);assert.equal(input.products.flatMap(product=>product.variants).length,20)
  assert.deepEqual(plan,original);assert.equal(approved.databaseWritesPerformed,false)
})

test('catalogue coordinator creates real products/options, resumes interrupted and uncertain commits, pairs owner API review and replays without source/stock/public writes', { timeout: 60_000 }, async () => {
  // A unique DEMO project isolates this fixture from both the running preview
  // and the real project. Only this test adapter labels the injected DB Main.
  const projectId = 'demo-main-catalogue-' + randomUUID().slice(0,8)
  const app = initializeApp({ projectId }, projectId), raw = getFirestore(app)
  assert.ok(raw.projectId.startsWith('demo-'))
  const original = (table,key) => raw.doc(`users/${owner}/${table}/${key}`)
  const rows = async table => (await raw.collection(`onlineShopV2/${shop}/${table}`).get()).docs.map(doc => ({...doc.data(),id:doc.id}))
  try {
    await original('stocks','brown').set({type:'Fixture dress',size:'Small',color:'Brown',quantity:5,price:100,date:'2026-01-01'})
    await original('stocks','blue').set({type:'Fixture dress',size:'Large',color:'Blue',quantity:4,price:120,date:'2026-01-01'})
    await original('orders','sale').set({date:'2026-01-02',total:500,paymentStatus:'unpaid',fulfillmentStatus:'reserved',items:[{id:'line',type:'Fixture dress',size:'Small',color:'Brown',quantity:1,unitPrice:500,unitCost:100,allocations:[{stockBatchId:'brown',quantity:1,unitCost:100}]}]})
    const originals = async () => Object.fromEntries(await Promise.all(['stocks','orders','payments','expenses','audit','catalog','meta','stockAdjustments','paymentReferences'].map(async table => [table,(await raw.collection(`users/${owner}/${table}`).get()).docs.map(doc => [doc.id,doc.data()])])))
    const before=await originals()
    const adapter={projectId:'pos-shop-owner',doc:path=>raw.doc(path),collection:path=>raw.collection(path),getAll:(...args)=>raw.getAll(...args),runTransaction:(...args)=>raw.runTransaction(...args)}
    const db=createMainSidecarFirestore(adapter,{writesEnabled:true}),catalog=createPosCatalog({db})
    const plan=await readLegacyCataloguePlan(db),body={expectedSnapshotHash:plan.snapshotHash,prices:plan.products.flatMap(product=>product.variants).map(variant=>({key:variant.key,price:variant.proposedPrice??600}))}
    const input=catalogueCreationInput(plan,body)
    assert.equal(input.products[0].variants.length,2)
    for(const invalid of [{...body,expectedSnapshotHash:'outdated'},{...body,prices:[]},{...body,prices:body.prices.map(row=>({...row,price:NaN}))},{...body,prices:[body.prices[0],body.prices[0]]}])assert.throws(()=>catalogueCreationInput(plan,invalid))
    const oldInput=structuredClone(input)
    for(const product of oldInput.products){for(const value of product.optionTree.values)if(value.level===1)value.id+='-old';for(const variant of product.variants)for(const choice of variant.optionPath)if(choice.level===1)choice.valueId+='-old'}
    await raw.doc(`onlineShopV2/${shop}/legacy_catalogue_jobs/main`).set({ownerUid:owner,input:oldInput,inputHash:digest(oldInput),sourceHash:plan.snapshotHash,status:'PAUSED',mappings:[],leaseToken:null,leaseUntil:0})
    let finishVariant,startedVariant
    const reached=new Promise(resolve=>{startedVariant=resolve}),hold=new Promise(resolve=>{finishVariant=resolve})
    let uncertain=true,interrupted=true
    const wrapped={...catalog,variants:{...catalog.variants,async save(...args){
      if(!uncertain&&interrupted){interrupted=false;throw Error('Fictional interrupted catalogue creation')}
      const value=await catalog.variants.save(...args)
      if(uncertain){uncertain=false;startedVariant();await hold;throw Error('Fictional lost variant response after commit')}return value}}}
    const service=createMainCatalogue({db,catalog:wrapped})
    const first=service.create(body,owner)
    await Promise.race([reached,first.then(()=>assert.fail('Expected the held variant commit'))])
    await assert.rejects(service.create(body,owner),error=>error.status===409&&error.message.includes('already running'))
    finishVariant()
    await assert.rejects(first,/Fictional interrupted catalogue creation/)
    const paused=await service.review()
    assert.equal(paused.creation.status,'PAUSED');assert.deepEqual(paused.creation.prices,body.prices)
    assert.equal((await rows('pos_products')).length,1);assert.equal((await rows('pos_products'))[0].variants.length,1)
    const result=await service.create(body,owner)
    assert.equal(result.productCount,1);assert.equal(result.variantCount,2);assert.equal(result.stockOpened,false);assert.equal(result.publicPublished,false)
    const products=await rows('pos_products')
    assert.equal(products.length,1);assert.equal(products[0].variants.length,2);assert.equal(products[0].units.length,1)
    assert.ok(result.mappings.every(mapping=>mapping.pos_product_id===products[0].id&&products[0].variants.some(variant=>variant.id===mapping.pos_variant_id)))
    const replay=await service.create(body,owner)
    assert.equal(replay.replayed,true);assert.deepEqual(replay.mappings,result.mappings)
    assert.equal((await rows('pos_products')).length,1)
    await assert.rejects(service.create({...body,prices:body.prices.map(row=>({...row,price:row.price+1}))},owner),error=>error.status===409)
    await assert.rejects(service.create(body,'other-owner'),{status:403})
    assert.equal((await rows('legacy_catalogue_jobs'))[0].status,'READY')
    assert.equal((await rows('legacy_catalogue_jobs'))[0].optionCorrections.length,1)
    assert.deepEqual((await rows('legacy_catalogue_jobs'))[0].optionCorrections[0].input,oldInput)
    const handler=createMainLocalHandler({rawDb:adapter,auth:{verifyIdToken:async token=>{if(token!=='fixture-owner')throw Error('No owner');return{uid:owner}}},bucket:{},approvalSecret:'fixture',writesEnabled:false})
    const request=async (handle,method,path,body,token='fixture-owner')=>{let status=200,data;const res={set:()=>res,status:value=>{status=value;return res},json:value=>{data=value;return res}};await handle({method,path,body,headers:{origin:'http://127.0.0.1:5178',authorization:`Bearer ${token}`}},res);return{status,data}}
    const reviewed=await request(handler,'GET',`/${shop}/admin/stock/legacy-catalogue-plan`)
    assert.equal(reviewed.status,200);assert.equal(reviewed.data.creationEnabled,false);assert.deepEqual(reviewed.data.creation.result.mappings,result.mappings)
    assert.equal((await request(handler,'GET',`/${shop}/admin/stock/legacy-catalogue-plan`,undefined,'other')).status,401)
    assert.equal((await request(handler,'POST',`/${shop}/admin/stock/legacy-catalogue`,body)).status,405)
    const writable=createMainLocalHandler({rawDb:adapter,auth:{verifyIdToken:async()=>({uid:owner})},bucket:{},approvalSecret:'fixture',writesEnabled:true})
    const posted=await request(writable,'POST',`/${shop}/admin/stock/legacy-catalogue`,body)
    assert.equal(posted.status,200);assert.equal(posted.data.replayed,true);assert.deepEqual(posted.data.mappings,result.mappings)
    for(const table of ['stock_balances','stock_batches','stock_movements','products','legacy_stock_baselines'])assert.deepEqual(await rows(table),[])
    assert.deepEqual(await originals(),before)
  } finally { await raw.terminate(); await deleteApp(app) }
})
