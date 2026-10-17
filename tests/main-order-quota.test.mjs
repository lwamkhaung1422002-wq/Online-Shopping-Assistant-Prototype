import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createMainSidecarFirestore } from '../../BelleLocal POS app/functions/src/main-local/firestore.js'
import { createMainLocalHandler } from '../../BelleLocal POS app/functions/src/main-local/api.js'
import { createPosOrderList } from '../../BelleLocal POS app/functions/src/pos/order-list.js'
import { createQuotaCooldown } from '../../BelleLocal POS app/functions/src/main-local/quota.js'
import { orderPaymentDisplay } from '../../BelleLocal POS app/src/features/retails/lib/salePaymentDisplay.js'

const owner = 'UXRbRF184gcohMkl4CdS0i0rdow2', shop = 'belle-online'
function memory() {
  const records = new Map(), reads = [], writes = []
  let fail = false
  const snap = path => ({ id:path.split('/').at(-1),ref:doc(path),exists:records.has(path),data:()=>structuredClone(records.get(path)) })
  const doc = path => ({ path,firestore:db,id:path.split('/').at(-1),get:async()=>{if(fail)throw Object.assign(Error('Quota exceeded'),{code:8});return snap(path)} })
  const collection = (path,filters=[]) => ({path,doc:key=>doc(`${path}/${key}`),
    where:(...args)=>collection(path,[...filters,args]),
    get:async()=>{reads.push(path);if(fail)throw Object.assign(Error('Quota exceeded'),{code:8});return {docs:[...records.keys()].filter(key=>key.startsWith(`${path}/`)&&key.split('/').length===path.split('/').length+1).map(snap).filter(row=>filters.every(([key,op,value])=>op==='=='?row.data()[key]===value:true))}},
  })
  const db={projectId:'pos-shop-owner',doc,collection,runTransaction:async(fn,options)=>fn({
    get:ref=>ref.get(),getAll:(...refs)=>Promise.all(refs.map(ref=>ref.get())),
    create:()=>{writes.push('create');assert.notEqual(options?.readOnly,true)},set:()=>{writes.push('set');assert.notEqual(options?.readOnly,true)},
  })}
  return {db,records,reads,writes,setFailure:value=>{fail=value}}
}

test('authenticated Order list searches original/current identities and preserves status/date without source writes',async()=>{
  const raw=memory(),path=`users/${owner}/orders/QqCHl8BRInz67ZomN9jY`
  raw.records.set(path,{date:'2026-07-23',customer:{name:'Historical Customer',phone:'09912345678'},fulfillmentStatus:'reserved',paymentStatus:'unpaid',items:[{type:'Elegence',size:'Size 1',color:'Brown',quantity:1,unitPrice:34500,unitCost:10000}],amountPaid:0})
  raw.records.set(`users/${owner}/orders/paid`,{date:'2026-07-24',customer:{name:'Paid Customer'},fulfillmentStatus:'completed',paymentStatus:'paid',items:[{type:'Short',size:'Size 2',color:'Pink',quantity:1,unitPrice:39500}],amountPaid:39500})
  raw.records.set(`onlineShopV2/${shop}/pos_orders/current`,{id:'current',orderNumber:'NEW-1',createdAt:'2026-07-25T10:00:00Z',total:1000,subtotal:1000,fulfillmentStatus:'completed',paymentStatus:'paid',saleType:'IN_STORE',items:[]})
  const before=structuredClone([...raw.records]),api=createMainLocalHandler({rawDb:raw.db,auth:{verifyIdToken:async()=>({uid:owner})},writesEnabled:true}),res={status(code){this.code=code;return this},set(){return this},json(body){this.body=body;return this}}
  await api({method:'GET',path:`/${shop}/admin/pos/orders`,headers:{authorization:'Bearer owner'},query:{search:'QqCHl8BRIn',view:'summary',paged:'true'}},res)
  assert.equal(res.body.totalCount,1)
  const old=res.body.orders[0]
  assert.equal(old.historyOrderId,'QqCHl8BRInz67ZomN9jY');assert.equal(old.legacyDate,'2026-07-23');assert.equal(old.total,34500)
  assert.deepEqual(old.payments,[]);assert.equal(orderPaymentDisplay(old).status,'Unpaid')
  const service=createPosOrderList({db:createMainSidecarFirestore(raw.db),ownerUid:owner})
  const paid=await service.list(shop,{paged:'true',paymentStatus:'paid',view:'summary'})
  assert.ok(paid.orders.some(row=>row.historyOrderId==='paid'))
  assert.equal(orderPaymentDisplay(paid.orders.find(row=>row.historyOrderId==='paid')).status,'Paid')
  assert.equal((await service.list(shop,{paged:'true',search:'09912345678'})).totalCount,1)
  assert.equal((await service.list(shop,{paged:'true',from:'2026-10-01',to:'2026-10-31'})).totalCount,0)
  assert.deepEqual([...raw.records],before);assert.deepEqual(raw.writes,[])
})

test('immutable collection cache reduces only read-only scans; source mutation checks remain fresh and failed reads never cache',async()=>{
  const raw=memory(),path=`users/${owner}/orders`,key=`${path}/original`
  raw.records.set(key,{total:100});let clock=0
  const db=createMainSidecarFirestore(raw.db,{writesEnabled:true,sourceCacheMs:1000,now:()=>clock}),read=()=>db.runTransaction(tx=>tx.get(db.collection(path)),{readOnly:true})
  await read();await read();assert.equal(raw.reads.length,1)
  raw.records.set(key,{total:200})
  const fresh=await db.runTransaction(tx=>tx.get(db.collection(path)))
  assert.equal(fresh.docs[0].data().total,200);assert.equal(raw.reads.length,2)
  clock=1001;assert.equal((await read()).docs[0].data().total,200);assert.equal(raw.reads.length,3)
  clock=2002;raw.setFailure(true);await assert.rejects(read(),{code:8});raw.setFailure(false);await read();assert.equal(raw.reads.length,5)
  const filtered=()=>db.runTransaction(tx=>tx.get(db.collection(path).where('total','==',200)),{readOnly:true})
  await filtered();await filtered();assert.equal(raw.reads.length,7)
  assert.deepEqual(raw.writes,[])
})

test('quota response is actionable and cooldown prevents immediate retry; only known detached SDK quota failures keep a process alive',async()=>{
  let clock=0;const quota=createQuotaCooldown({now:()=>clock,delayMs:1000})
  assert.equal(quota.note({code:8}),true);assert.equal(quota.remainingSeconds(),1);clock=1001;assert.equal(quota.remainingSeconds(),0)
  assert.equal(quota.note(Error('unexpected')),false)
  const raw=memory();raw.setFailure(true)
  const handler=createMainLocalHandler({rawDb:raw.db,auth:{},onBackendError:error=>quota.note(error)})
  const res={status(code){this.code=code;return this},set(){return this},json(value){this.body=value;return this}}
  await handler({method:'GET',path:`/${shop}/settings`,headers:{}},res)
  assert.equal(res.code,503);assert.equal(res.body.code,'FIRESTORE_QUOTA_EXCEEDED');assert.ok(quota.remainingSeconds()>0)
  const module=new URL('../../BelleLocal POS app/functions/src/main-local/quota.js',import.meta.url).href
  const child=code=>spawnSync(process.execPath,['--input-type=module','-e',`import {createQuotaCooldown,installQuotaFailureHandler} from ${JSON.stringify(module)};const quota=createQuotaCooldown();installQuotaFailureHandler(quota);Promise.reject(Object.assign(Error('fault'),{code:${code}}));setTimeout(()=>console.log(quota.remainingSeconds()>0),25);`],{encoding:'utf8'})
  const expected=child(8);assert.equal(expected.status,0);assert.equal(expected.stdout.trim(),'true')
  assert.notEqual(child(9).status,0)
})
