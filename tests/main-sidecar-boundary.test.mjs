import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createMainSidecarFirestore } from '../../BelleLocal POS app/functions/src/main-local/firestore.js'
import { assertMainLocalStartup } from '../../BelleLocal POS app/functions/src/main-local/startup.js'
import { createLoopbackOrderGuard, createMainLocalHandler } from '../../BelleLocal POS app/functions/src/main-local/api.js'

const owner = 'UXRbRF184gcohMkl4CdS0i0rdow2', shop = 'belle-online'
const originalPath = `users/${owner}/orders/original`, sidecarPath = `onlineShopV2/${shop}/pos_orders/new`
function memory() {
  const records = new Map([[originalPath, { total: 34500, paymentStatus: 'unpaid' }]])
  const writes = [], transactions = []
  const doc = path => ({ path, id: path.split('/').at(-1), firestore: db,
    get: async () => snap(path), create: async data => { writes.push(['create',path]); records.set(path,structuredClone(data)) },
    set: async data => { writes.push(['set',path]); records.set(path,structuredClone(data)) },
    update: async data => { writes.push(['update',path]); records.set(path,{...records.get(path),...data}) }, delete: async () => { writes.push(['delete',path]); records.delete(path) },
  })
  const snap = path => ({ id:path.split('/').at(-1), exists:records.has(path), ref:doc(path), data:()=>structuredClone(records.get(path)), get:key=>records.get(path)?.[key] })
  const collection = path => ({ path, doc:key=>doc(`${path}/${key}`), where:()=>collection(path), orderBy:()=>collection(path),limit:()=>collection(path),startAfter:()=>collection(path),
    get:async()=>({docs:[...records.keys()].filter(key=>key.startsWith(path+'/')).map(snap)}) })
  const db = { projectId:'pos-shop-owner', doc,collection,getAll:async(...refs)=>Promise.all(refs.map(ref=>ref.get())),
    async runTransaction(fn,options) {
      transactions.push(options); const pending=[]
      const tx={get:ref=>ref.get(),getAll:(...refs)=>Promise.all(refs.map(ref=>ref.get()))}
      for(const method of ['create','set','update','delete'])tx[method]=(ref,...args)=>{assert.notEqual(options?.readOnly,true);pending.push(()=>ref[method](...args));return tx}
      const value=await fn(tx); for(const action of pending)await action(); return value
    },
  }
  return {db,records,writes,transactions}
}

test('Main business source refs stay immutable, including returned refs and transactions with earlier sidecar writes',async()=>{
  const raw=memory(),db=createMainSidecarFirestore(raw.db,{writesEnabled:true}),before=structuredClone([...raw.records])
  const ref=db.doc(originalPath),returned=(await ref.get()).ref
  for(const target of [ref,returned])for(const method of ['set','create','update','delete'])assert.throws(()=>target[method]({total:1}),{status:405})
  await assert.rejects(db.runTransaction(tx=>{tx.create(db.doc(sidecarPath),{total:100});tx.update(ref,{paymentStatus:'paid'})}),{status:405})
  for(const method of ['create','set','update','delete'])await assert.rejects(db.runTransaction(tx=>tx[method](returned,{total:1})),{status:405})
  assert.deepEqual([...raw.records],before);assert.deepEqual(raw.writes,[])
  assert.equal(ref.firestore,undefined);assert.equal(returned.parent,undefined);assert.equal(returned._raw,undefined)
})

test('only explicit sidecar mode allows atomic new records; explicit reads cannot mutate and default mode never writes',async()=>{
  const raw=memory(),db=createMainSidecarFirestore(raw.db,{writesEnabled:true})
  await db.runTransaction(async tx=>{const source=await tx.get(db.doc(originalPath));tx.create(db.doc(sidecarPath),{originalTotal:source.data().total});tx.create(db.doc(`onlineShopV2/${shop}/legacy_events/event`),{action:'complete'})})
  assert.equal(raw.records.get(sidecarPath).originalTotal,34500)
  assert.deepEqual(raw.records.get(originalPath),{total:34500,paymentStatus:'unpaid'})
  await assert.rejects(db.runTransaction(tx=>tx.set(db.doc(sidecarPath),{total:0}),{readOnly:true}),{status:405})
  assert.throws(()=>db.doc(`onlineShopV2/${shop}/legacy_events/event`).delete(),{status:405})
  const readonly=createMainSidecarFirestore(raw.db)
  assert.throws(()=>readonly.doc(sidecarPath).update({total:0}),{status:405})
  await assert.rejects(readonly.runTransaction(tx=>tx.create(readonly.doc(sidecarPath),{})),{status:405})
  assert.deepEqual(raw.transactions.at(-1),{readOnly:true})
})

test('other owners/shops, SDK escape operations, wrong project and authority owner changes are rejected',async()=>{
  const raw=memory(),db=createMainSidecarFirestore(raw.db,{writesEnabled:true})
  for(const path of ['users/other/orders/row',`users/${owner}/secrets/row`,'onlineShopV2/other/pos_orders/row',`onlineShopV2/${shop}/pos_orders/row/private/secret`])assert.throws(()=>db.doc(path),{status:403})
  for(const path of ['onlineShopV2','users',`onlineShopV2/${shop}/pos_orders/row/private`])assert.throws(()=>db.collection(path),{status:403})
  for(const method of ['batch','bulkWriter','recursiveDelete','collectionGroup'])assert.throws(()=>db[method](),{status:405})
  assert.throws(()=>createMainSidecarFirestore({...raw.db,projectId:'other'}),{status:403})
  assert.throws(()=>db.doc(`onlineShopV2/${shop}/pos_shop/main`).set({ownerId:'other'}),{status:403})
  const claim=db.doc(`onlineShopV2/_legacy_sources/source_claims/${createHash('sha256').update(JSON.stringify(owner)).digest('hex')}`)
  assert.throws(()=>claim.create({owner_uid:'other',shop_id:shop}),{status:403})
  assert.throws(()=>claim.create({owner_uid:owner,shop_id:'other'}),{status:403})
  assert.throws(()=>claim.set({owner_uid:owner,shop_id:shop}),{status:403})
  assert.throws(()=>claim.delete(),{status:403})
  await assert.rejects(db.runTransaction(tx=>tx.get(raw.db.doc(originalPath))),{status:403})
  assert.deepEqual(raw.writes,[])
})

test('startup binds the real project and requires separate writes and stopped original stock writers before checkout',()=>{
  const env={GOOGLE_APPLICATION_CREDENTIALS:'fixture'},stat=()=>({isFile:()=>true}),run=args=>assertMainLocalStartup({args,env,stat})
  assert.equal(run(['--run-live']).writesEnabled,false)
  assert.equal(run(['--run-live','--allow-sidecar-writes']).checkoutEnabled,false)
  assert.equal(run(['--run-live','--allow-sidecar-writes','--legacy-writers-stopped','--local-media']).localMediaEnabled,true)
  assert.equal(run(['--run-live','--local-media']).writesEnabled,false)
  const full=run(['--run-live','--allow-sidecar-writes','--legacy-writers-stopped','--allow-checkout'])
  assert.equal(full.checkoutEnabled,true);assert.equal(full.legacyOpeningEnabled,true)
  for(const args of [[],['--run-live','--run-live'],['--run-live','--allow-checkout'],['--run-live','--allow-sidecar-writes','--allow-checkout'],['--run-live','--unknown']])assert.throws(()=>run(args),/No database request made/)
  assert.throws(()=>assertMainLocalStartup({args:['--run-live'],env:{...env,GOOGLE_CLOUD_QUOTA_PROJECT:'other'},stat}),/does not match/)
})

test('Main local API denies unrelated shops and disabled mutations before DB writes; only loopback public ordering is admitted',async()=>{
  const raw=memory(),handler=createMainLocalHandler({rawDb:raw.db,auth:{},bucket:{},approvalSecret:'fixture-only'})
  async function request(path,method='GET',origin='http://127.0.0.1:5178') {let status=200,data;const res={set:()=>res,status:value=>{status=value;return res},json:value=>{data=value;return res}};await handler({path,method,headers:{origin}},res);return {status,data}}
  assert.equal((await request('/other/admin/pos/products')).status,404)
  assert.equal((await request(`/${shop}/admin/pos/products`,'POST')).status,405)
  assert.equal((await request('/shops','POST')).status,405)
  assert.equal((await request(`/${shop}/catalog`,'GET','https://unrelated.example')).status,403)
  const guard=createLoopbackOrderGuard({now:()=>0}),req={headers:{origin:'http://127.0.0.1:5179'},socket:{remoteAddress:'127.0.0.1'}}
  await guard(shop,'checkout',req)
  await assert.rejects(guard(shop,'checkout',{...req,socket:{remoteAddress:'192.168.1.2'}}),{status:403})
  for(let count=1;count<120;count++)await guard(shop,'track-order',req)
  await assert.rejects(guard(shop,'track-order',req),{status:429})
  assert.deepEqual(raw.writes,[])
})

test('Main business GET pairs the real owner profile and Settings defaults without creating sidecars',async()=>{
  const raw=memory(),verified=[]
  const auth={async verifyIdToken(token,revoked){verified.push([token,revoked]);if(token!=='owner-token')throw Object.assign(Error('Invalid'),{code:'auth/invalid-id-token'});return {uid:owner}}}
  const handler=createMainLocalHandler({rawDb:raw.db,auth,bucket:{},approvalSecret:'fixture-only'})
  async function request(path,token='owner-token'){let status=200,data;const res={set:()=>res,status:value=>{status=value;return res},json:value=>{data=value;return res}};await handler({path,method:'GET',headers:{origin:'http://127.0.0.1:5178',authorization:`Bearer ${token}`},query:{},body:{}},res);return {status,data}}
  const profile=await request('/shops')
  assert.equal(profile.status,200);assert.equal(profile.data.shops[0].id,shop);assert.equal(profile.data.shops[0].ownerId,owner)
  const session=await request(`/${shop}/admin/pos/profile`)
  assert.deepEqual(session.data.mainRuntime,{writesEnabled:false,checkoutEnabled:false,originalRecordsImmutable:true})
  const member=await request(`/${shop}/admin/me`)
  assert.deepEqual(member.data.mainRuntime,session.data.mainRuntime)
  const enabled=createMainLocalHandler({rawDb:raw.db,auth,bucket:{},approvalSecret:'fixture-only',writesEnabled:true,legacyOpeningEnabled:true})
  let enabledData;const enabledResponse={set:()=>enabledResponse,status:()=>enabledResponse,json:value=>{enabledData=value;return enabledResponse}}
  await enabled({path:`/${shop}/admin/pos/profile`,method:'GET',headers:{origin:'http://127.0.0.1:5178',authorization:'Bearer owner-token'},query:{},body:{}},enabledResponse)
  assert.deepEqual(enabledData.mainRuntime,{writesEnabled:true,checkoutEnabled:false,originalRecordsImmutable:true})
  assert.equal((await request(`/${shop}/admin/pos/profile`,'other')).status,401)
  const settings=await request(`/${shop}/admin/pos/settings`)
  assert.equal(settings.status,200);assert.equal(settings.data.settings.currencyCode,'MMK')
  assert.equal((await request(`/${shop}/admin/pos/settings`,'other')).status,401)
  assert.ok(verified.every(([,revoked])=>revoked===true));assert.deepEqual(raw.writes,[])
  assert.equal(raw.records.size,1)
})
