import test from 'node:test'
import assert from 'node:assert/strict'
import {createApi as publicApi} from '../dashboard/shared/firebase.js'
import {createApi as ownerApi} from '../../BelleLocal POS app/src/features/shop-admin/editor/shared/firebase.js'
import {createQuotaBackoff as publicQuota} from '../dashboard/shared/request-quota.js'
import {createQuotaBackoff as ownerQuota} from '../../BelleLocal POS app/src/features/shop-admin/editor/shared/request-quota.js'

test('public/owner clients surface unreachable services and real quota errors without replacing catalogue data',async()=>{
  const original=globalThis.fetch
  try {
    const configuration={configured:true,shopId:'belle-online',apiUrl:'http://127.0.0.1:5003'}
    globalThis.fetch=async()=>{throw new TypeError('Failed to fetch')}
    for(const create of [publicApi,ownerApi])await assert.rejects(create(configuration)('catalog'),error=>/Cannot reach/.test(error.message))
    globalThis.fetch=async()=>new Response(JSON.stringify({error:'Firestore quota exceeded.',code:'FIRESTORE_QUOTA_EXCEEDED'}),{status:503,headers:{'Content-Type':'application/json'}})
    await assert.rejects(publicApi(configuration)('catalog'),error=>error.status===503&&error.code==='FIRESTORE_QUOTA_EXCEEDED')
    await assert.rejects(ownerApi(configuration)('catalog'),error=>error.status===503&&error.message==='Firestore quota exceeded.'&&error.payload.code==='FIRESTORE_QUOTA_EXCEEDED')
  } finally {globalThis.fetch=original}
})

test('quota backoff stops public/owner reads and writes without pretending they succeeded, and allows a fresh request after expiry',async(t)=>{
  for (const [createApi,createQuota] of [[publicApi,publicQuota],[ownerApi,ownerQuota]]) {
    let clock=0, requests=0
    const quota=createQuota({now:()=>clock})
    t.mock.method(globalThis,'fetch',async()=>{
      requests++
      return requests===1
        ? new Response(JSON.stringify({error:'Quota exceeded',code:'FIRESTORE_QUOTA_EXCEEDED'}),{status:503,headers:{'Content-Type':'application/json','Retry-After':'60'}})
        : new Response(JSON.stringify({saved:true}),{headers:{'Content-Type':'application/json'}})
    })
    const api=createApi({configured:true,shopId:'belle-online',apiUrl:'http://127.0.0.1:5003',quota})
    const isQuota=error=>error.code==='FIRESTORE_QUOTA_EXCEEDED'&&error.status===503&&error.definitive===false
    await assert.rejects(api('catalog'),isQuota)
    await assert.rejects(api('settings'),isQuota)
    await assert.rejects(api('checkout',{items:[]}),isQuota)
    assert.equal(requests,1)
    clock=60_000
    assert.deepEqual(await api('settings'),{saved:true})
    assert.equal(requests,2)
    t.mock.restoreAll()
  }
})

test('quota fallback delays only quota errors; validation errors do not stop later requests',()=>{
  for(const create of [publicQuota,ownerQuota]) {
    let clock=0
    const quota=create({now:()=>clock}),error=Object.assign(Error('Quota'),{code:'FIRESTORE_QUOTA_EXCEEDED'})
    quota.note({},Object.assign(Error('Invalid'),{code:'VALIDATION_ERROR'}))
    assert.doesNotThrow(()=>quota.check())
    quota.note({},error)
    assert.throws(()=>quota.check(),error)
    clock=300_000
    assert.doesNotThrow(()=>quota.check())
  }
})
