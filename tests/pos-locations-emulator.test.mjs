import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {createPosLocations} from '../../BelleLocal POS app/functions/src/pos/locations.js'
import {createPosCatalog} from '../../BelleLocal POS app/functions/src/pos/catalog.js'

if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Location acceptance requires the isolated local Firebase emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url))
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
initializeApp({projectId:'demo-belle-online'});const db=getFirestore(),auth=getAuth(),locations=createPosLocations({db}),catalog=createPosCatalog({db})
const collection=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`)
const base='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
async function token(uid,email){try{await auth.createUser({uid,email,password:'Local-test-only-123!'})}catch(error){if(!['auth/uid-already-exists','auth/email-already-exists'].includes(error.code))throw error}const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Local-test-only-123!',returnSecureToken:true})});assert.equal(response.status,200);return (await response.json()).idToken}
async function http(path,owner,body){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer '+owner}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()}}
async function state(shop){const value={};for(const name of ['pos_locations','pos_location_locks','pos_products','stock_batches','stock_balances','stock_reservations','stock_movements','stock_requests','pos_audit','pos_requests','pos_sequences'])value[name]=(await collection(shop,name).get()).docs.map(row=>[row.id,row.data()]);return value}

test('Location HTTP uses source types/defaults, exact shop/name uniqueness, owner-only scope and ignores unrelated GET filters',async()=>{
  const owner=await token('demo-owner','owner@belle-demo.example'),other=await token('demo-other','other@belle-demo.example'),suffix=randomUUID()
  assert.equal((await http('locations',undefined)).status,401);assert.equal((await http('locations',other)).status,403)
  assert.equal((await http('locations',undefined,{name:'Unauthorized'})).status,401);assert.equal((await http('locations',other,{name:'Unauthorized'})).status,403)
  const name='Location '+suffix,created=await http('locations',owner,{name:' '+name+' ',shopId:'other-shop',isActive:false,createdAt:'Forged date',id:'forged-id'})
  assert.equal(created.status,201);const row=created.data.location;assert.equal(row.name,name);assert.equal(row.type,'SELLABLE');assert.equal(row.isActive,true);assert.equal(row.shopId,'belle-online');assert.notEqual(row.id,'forged-id');assert.notEqual(row.createdAt,'Forged date');assert.equal(row.updatedAt,row.createdAt)
  assert.deepEqual((await collection('belle-online','pos_locations').doc(row.id).get()).data(),row)
  assert.equal((await http('locations',owner,{name,type:'QUARANTINE'})).status,409)
  assert.equal((await http('locations',owner,{name:name.toUpperCase(),type:'DAMAGED'})).status,201)
  for(const type of ['QUARANTINE','DAMAGED','TRANSIT']){const result=await http('locations',owner,{name:type+' '+suffix,type});assert.equal(result.status,201);assert.equal(result.data.location.type,type)}
  for(const input of [{},{name:'  '},{name:'Bad '+suffix,type:'OTHER'},{name:7},{name:'Bad '+suffix,type:null}])assert.equal((await http('locations',owner,input)).status,400)
  const list=await http('locations?search=does-not-exist&page=999&status=inactive',owner);assert.equal(list.status,200);assert(list.data.locations.some(value=>value.id===row.id));assert(list.data.locations.every(value=>value.shopId==='belle-online'));assert.deepEqual(Object.keys(list.data),['locations'])
})

test('Location creation serializes exact duplicate names while preserving case distinctions and independent shops; large input rolls back completely',async()=>{
  const shop='locations-'+randomUUID();assert.deepEqual(await locations.list(shop),{locations:[]})
  for(let round=0;round<4;round++){
    const name='Receiving '+round,results=await Promise.allSettled(Array.from({length:4},()=>locations.create(shop,{name,type:'QUARANTINE'})))
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);for(const result of results.filter(value=>value.status==='rejected'))assert.equal(result.reason.status,409)
  }
  await locations.create(shop,{name:'Main'});await locations.create(shop,{name:'main'});const other=await locations.create('locations-'+randomUUID(),{name:'Main'});assert.equal(other.location.name,'Main')
  const inactive={...(await locations.list(shop)).locations[0],id:randomUUID(),name:'Inactive retained location',isActive:false};await collection(shop,'pos_locations').doc(inactive.id).set(inactive)
  const before=await state(shop);await assert.rejects(locations.create(shop,{name:'X'.repeat(850001)}),{status:409});assert.deepEqual(await state(shop),before)
  const rows=(await locations.list(shop)).locations;assert.equal(rows.length,7);assert(rows.some(row=>row.id===inactive.id&&row.isActive===false))
  for(let index=1;index<rows.length;index++)assert(rows[index-1].name.localeCompare(rows[index].name)<=0)
})

test('Location metadata never receives, transfers or exposes stock and cannot edit any original Belle collection',async()=>{
  const shop='locations-stock-'+randomUUID(),product=await catalog.create(shop,{name:'Location-independent product',price:300,cost:100,units:[{name:'Piece',conversionFactor:1,isBase:true}],openingStock:{quantity:5,unitCost:100}},'demo-owner',randomUUID())
  const legacyKey=randomUUID(),originals={};for(const name of ['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta']){const target=db.doc(`users/demo-owner/${name}/${legacyKey}`),value={source:name,amount:34500,status:'reserved',paymentStatus:'unpaid'};await target.set(value);originals[target.path]=value}
  const before=await state(shop);for(const type of ['SELLABLE','QUARANTINE','DAMAGED','TRANSIT'])await locations.create(shop,{name:type,type,stockQuantity:1000,productId:product.id})
  await locations.list(shop);const after=await state(shop);for(const name of Object.keys(before).filter(name=>!['pos_locations','pos_location_locks'].includes(name)))assert.deepEqual(after[name],before[name])
  for(const [path,value]of Object.entries(originals))assert.deepEqual((await db.doc(path).get()).data(),value)
  const publicToken=await token('demo-other','other@belle-demo.example');assert.equal((await http('locations',publicToken)).status,403)
})
