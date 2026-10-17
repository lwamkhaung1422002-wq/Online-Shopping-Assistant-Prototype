import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { shopPath, normalizeProduct, publicProduct, checkoutInput } from '../../BelleLocal POS app/functions/src/online-shop/domain.js'
import { createShopApi } from '../../BelleLocal POS app/functions/src/online-shop/api.js'
import { createOrderService } from '../../BelleLocal POS app/functions/src/online-shop/orders.js'

// Transaction double tests domain rollback and replay logic; emulator tests are separate.
function database() {
  const records = new Map(); let queue = Promise.resolve()
  const snap = (path) => ({ id: path.split('/').at(-1), ref: { path }, exists: records.has(path), data: () => structuredClone(records.get(path)) })
  const db = {
    records, doc: (path) => ({ path, id: path.split('/').at(-1) }), collection: (path) => ({ path, collection: true }),
    runTransaction(callback) {
      const result = queue.then(async () => {
        const writes = []
        const tx = {
          get: async (ref) => ref.collection ? { docs: [...records.keys()].filter((p) => p.startsWith(ref.path+'/') && p.split('/').length === ref.path.split('/').length+1).map(snap) } : snap(ref.path),
          set: (ref, value) => writes.push(() => records.set(ref.path, structuredClone(value))),
          create: (ref, value) => { if (records.has(ref.path)) throw Error('Already exists'); writes.push(() => records.set(ref.path, structuredClone(value))) },
          update: (ref, value) => writes.push(() => records.set(ref.path, { ...records.get(ref.path), ...structuredClone(value) })),
          delete: (ref) => writes.push(() => records.delete(ref.path)),
        }
        await callback(tx); writes.forEach((commit) => commit())
      })
      queue = result.catch(() => {}); return result
    },
  }
  return db
}
const input = () => ({ name: 'Elegence', slug: 'elegence', description: '', status: 'published', variants: [{ color: 'Brown', size: '1', sku: 'EL-1-B', price: 34500, active: true }] })
function fixture() {
  const db = database(); const product = normalizeProduct(input(), null, 'belle-online')
  product.variants[0].on_hand = 2
  db.records.set(shopPath('belle-online','products',product.id), product)
  db.records.set('users/legacy-owner/orders/legacy-sale', { total:34500, paymentStatus:'unpaid', fulfillmentStatus:'reserved' })
  const order = () => ({ request_key: randomUUID(), tracking_token:'a'.repeat(64), customer:{name:'Yu Thandar Win',phone:'09942988167',city:'Yangon',address:'Address'}, note:'', items:[{variant_id:product.variants[0].id,quantity:1,measurements:{}}] })
  return { db, product, order }
}
test('write repository rejects legacy paths and caller supplied collection paths', () => {
  assert.equal(shopPath('belle-online','orders','new'),'onlineShopV2/belle-online/orders/new')
  for (const [shop, table, key] of [['users/owner','orders','sale'],['belle','users','sale'],['belle','orders','../sale']]) assert.throws(() => shopPath(shop,table,key))
})
test('product editor preserves counters and historical variant IDs', () => {
  const old = normalizeProduct(input(),null,'belle'); old.variants[0].on_hand=5; old.variants[0].reserved=2
  const updated = normalizeProduct({...input(),variants:[{...old.variants[0],on_hand:500,reserved:0}]},old,'belle')
  assert.equal(updated.variants[0].on_hand,5); assert.equal(updated.variants[0].reserved,2)
  assert.throws(() => normalizeProduct({...input(),variants:[input().variants[0]]},old,'belle'),/Deactivate/)
})
test('catalog projection omits costs and private record fields', () => {
  const p=normalizeProduct(input(),null,'belle'); p.cost=123; p.customer='secret'; p.variants[0].cost=456
  p.category_id='category'; p.size_guide_id='guide'; p.memberships=[{collection_id:'new',private_note:'secret'}]
  const result=publicProduct(p,[{id:'category',name:'Dresses',cost:999,private_note:'secret'}],[{id:'guide',name:'Sizes',customer:'secret',fields:[{key:'weight',label:'Weight',unit:'lb',cost:999}],sizes:[{id:'S',label:'Small',weight:[90,120],profit:777}]}])
  assert.equal(result.cost,undefined); assert.equal(result.customer,undefined); assert.equal(result.variants[0].cost,undefined)
  assert.equal(result.category.cost,undefined); assert.equal(result.guide.customer,undefined); assert.equal(result.guide.fields[0].cost,undefined)
  assert.equal(result.guide.sizes[0].profit,undefined); assert.equal(result.memberships[0].private_note,undefined)
  assert.deepEqual(result.guide.sizes[0].weight,[90,120])
})
test('checkout validates whole stock quantities and request credentials', () => {
  const {order}=fixture(); const value=order()
  assert.throws(() => checkoutInput({...value,items:[{...value.items[0],quantity:1.5}]}),/whole/)
  assert.throws(() => checkoutInput({...value,items:[value.items[0],value.items[0]]}),/duplicate/)
  assert.throws(() => checkoutInput({...value,tracking_token:'abc'}),/token/)
})
test('stock 2 rejects quantity 3 without writing order, inventory or legacy records', async () => {
  const {db,order}=fixture(); const before=structuredClone([...db.records]); const service=createOrderService({db,checkoutEnabled:true}); const value=order(); value.items[0].quantity=3
  await assert.rejects(service.checkout('belle-online',value),/available stock/)
  assert.deepEqual([...db.records],before)
})
test('request replay creates one order and reserves once, price comes from server', async () => {
  const {db,product,order}=fixture(); const service=createOrderService({db,checkoutEnabled:true}); const value=order(); value.items[0].price=1
  const a=await service.checkout('belle-online',value); const b=await service.checkout('belle-online',value)
  assert.deepEqual(a,b); assert.equal(db.records.get(shopPath('belle-online','products',product.id)).variants[0].reserved,1)
  assert.equal(db.records.get(shopPath('belle-online','orders',value.request_key)).total,34500)
  await assert.rejects(service.checkout('belle-online',{...value,note:'changed'}),/different order/)
  await assert.rejects(service.checkout('belle-online',{...value,note:'changed'}), (error) => error.orderRejected === false)
})
test('simultaneous requests respect available stock in a serial transaction double', async () => {
  const {db,product,order}=fixture(); const service=createOrderService({db,checkoutEnabled:true})
  const results=await Promise.allSettled([service.checkout('belle-online',order()),service.checkout('belle-online',order()),service.checkout('belle-online',order())])
  assert.equal(results.filter((r)=>r.status==='fulfilled').length,2)
  assert.equal(db.records.get(shopPath('belle-online','products',product.id)).variants[0].reserved,2)
})
test('accept creates invoice draft; cancel/reject and delivered transitions apply reservation once', async () => {
  const {db,product,order}=fixture(); const service=createOrderService({db,checkoutEnabled:true}); const value=order()
  await service.checkout('belle-online',value)
  await service.transition('belle-online',value.request_key,{status:'confirmed'},'owner')
  assert.equal(db.records.get(shopPath('belle-online','orders',value.request_key)).invoice_draft.total,34500)
  await service.transition('belle-online',value.request_key,{status:'packing'},'owner')
  await service.transition('belle-online',value.request_key,{status:'shipped',courier:'Delivery'},'owner')
  await service.transition('belle-online',value.request_key,{status:'delivered'},'owner')
  await service.transition('belle-online',value.request_key,{status:'delivered'},'owner')
  const variant=db.records.get(shopPath('belle-online','products',product.id)).variants[0]
  assert.equal(variant.on_hand,1); assert.equal(variant.reserved,0)
  const second=order(); await service.checkout('belle-online',second)
  await service.transition('belle-online',second.request_key,{status:'rejected'},'owner')
  await service.transition('belle-online',second.request_key,{status:'rejected'},'owner')
  assert.equal(db.records.get(shopPath('belle-online','products',product.id)).variants[0].reserved,0)
  assert.deepEqual(db.records.get('users/legacy-owner/orders/legacy-sale'),{total:34500,paymentStatus:'unpaid',fulfillmentStatus:'reserved'})
})
test('production gate refuses new checkouts, API verifies owner and denies unsupported writes', async () => {
  const {db,order}=fixture(); const before=structuredClone([...db.records])
  await assert.rejects(createOrderService({db,checkoutEnabled:false}).checkout('belle-online',order()),/not enabled/)
  assert.deepEqual([...db.records],before)
  const api=createShopApi({db,auth:{verifyIdToken:async(token)=>({uid:token})},bucket:{},allowedShopId:'belle-online',ownerUid:'owner'})
  async function request(route,token,method='GET') {
    let code=200, data; const res={set(){},status(v){code=v;return this},json(v){data=v;return this},send(){}}
    await api({path:'/belle-online/'+route,headers:token?{authorization:'Bearer '+token}:{},method,body:{}},res)
    return {code,data}
  }
  assert.equal((await request('admin/me')).code,401)
  assert.equal((await request('admin/me','other')).code,403)
  assert.equal((await request('admin/me','owner')).data.role,'owner')
  assert.equal((await request('admin/records/orders','owner','POST')).code,400)
})

test('reservation expiry rechecks state, rejects late acceptance and releases once with movement audit', async () => {
  const { db, product, order } = fixture(); let timestamp = Date.parse('2026-10-11T00:00:00Z')
  const service = createOrderService({ db, checkoutEnabled: true, now: () => timestamp }); const value = order()
  await service.checkout('belle-online', value)
  timestamp += 48 * 60 * 60 * 1000
  await assert.rejects(service.transition('belle-online', value.request_key, { status: 'confirmed' }, 'owner'), /expired/)
  assert.equal((await service.transition('belle-online', value.request_key, { status: 'expired' }, 'scheduler', true)).changed, true)
  assert.equal((await service.transition('belle-online', value.request_key, { status: 'expired' }, 'scheduler', true)).changed, false)
  assert.equal(db.records.get(shopPath('belle-online', 'products', product.id)).variants[0].reserved, 0)
  const movements = [...db.records].filter(([path]) => path.includes('/inventory_movements/')).map(([, value]) => value)
  assert.equal(movements.length, 2); assert.deepEqual(movements.map((v) => v.kind).sort(), ['reservation', 'reservation_release'])
  const second = order(); await service.checkout('belle-online', second)
  await service.transition('belle-online', second.request_key, { status: 'confirmed' }, 'owner')
  timestamp += 49 * 60 * 60 * 1000
  assert.equal((await service.transition('belle-online', second.request_key, { status: 'expired' }, 'scheduler', true)).changed, false)
  assert.equal(db.records.get(shopPath('belle-online', 'products', product.id)).variants[0].reserved, 1)
})
