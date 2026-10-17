import test from 'node:test'
import assert from 'node:assert/strict'
import { projectDirectAvailability, directStockScope, scaledQuantity, quantityText } from '../../BelleLocal POS app/src/features/firebase-direct/availability-model.js'
import { createHash } from 'node:crypto'

const source = { posts: [{id:'post',status:'published',variants:[{id:'choice',active:true,on_hand:9999,reserved:0}]}],
  bindings:[{id:'choice',public_variant_id:'choice',public_product_id:'post',pos_product_id:'pos',pos_variant_id:'variant',scope_key:await directStockScope('pos','variant')}],
  products:[{id:'pos',isActive:true,trackingMode:'NONE',cost:12000,variants:[{id:'variant',price:34500,isActive:true}]}],
  balances:[{id:await directStockScope('pos','variant'),productId:'pos',variantId:'variant',onHand:'2',reserved:'0',cost:12000,sourceLedger:{onHand:'999',reserved:'0'}}] }

test('browser stock scope hashes match existing ledger identities and decimal quantities do not round up free stock',()=>{
  assert.equal(source.bindings[0].scope_key,createHash('sha256').update(JSON.stringify(['pos','variant','main'])).digest('hex'))
  assert.equal(quantityText(scaledQuantity('1.010')),'1.01')
  assert.equal(scaledQuantity('4000000000'),4000000000000n)
  for(const value of ['-1','1.0001','1e2','NaN','01','1000000000000000'])assert.throws(()=>scaledQuantity(value),{status:409})
})

test('availability uses actual physical balances, excludes frozen ledger/CMS counters/private cost and follows POS price',async()=>{
  const [row]=await projectDirectAvailability(source)
  assert.deepEqual(row,{id:'choice',available:2,on_hand:'2',reserved:'0',price:34500})
  const fractional=await projectDirectAvailability({...source,balances:[{...source.balances[0],onHand:'2.9',reserved:'0.001'}]})
  assert.equal(fractional[0].available,2)
  assert.ok(!('cost' in row));assert.ok(!('sourceLedger' in row))
})

test('all sellable locations contribute exactly once; hidden/inactive choices are unavailable and unknown scopes reject',async()=>{
  const storage={id:await directStockScope('pos','variant','storage'),productId:'pos',variantId:'variant',locationId:'storage',onHand:'50',reserved:'0'}
  const second={id:await directStockScope('pos','variant','counter'),productId:'pos',variantId:'variant',locationId:'counter',onHand:'3',reserved:'1'}
  const locations=[{id:'storage',type:'NON_SELLABLE',isActive:true},{id:'counter',type:'SELLABLE',isActive:true}]
  assert.equal((await projectDirectAvailability({...source,balances:[...source.balances,storage,second],locations}))[0].available,4)
  assert.equal((await projectDirectAvailability({...source,posts:[{...source.posts[0],status:'hidden'}]}))[0].available,0)
  assert.equal((await projectDirectAvailability({...source,products:[{...source.products[0],isActive:false}]}))[0].available,0)
  await assert.rejects(projectDirectAvailability({...source,balances:[storage]}),{status:409})
  await assert.rejects(projectDirectAvailability({...source,bindings:[]}),{status:409})
  await assert.rejects(projectDirectAvailability({...source,balances:[{...source.balances[0],reserved:'3'}]}),{status:409})
})

test('serial capacity excludes allocated/held identities; unconverted recipe projection rejects instead of reporting false stock',async()=>{
  const serials=['a','b','c'].map(id=>({id,productId:'pos',variantId:'variant',status:'IN_STOCK'}))
  const result=await projectDirectAvailability({...source,products:[{...source.products[0],trackingMode:'SERIAL'}],serials,allocations:[{id:'a'}],guestHolds:[{id:'b',status:'ACTIVE'}]})
  assert.equal(result[0].available,1)
  await assert.rejects(projectDirectAvailability({...source,products:[{...source.products[0],recipe:{ingredients:[]}}]}),error=>error.status===501&&error.code==='DIRECT_RECIPE_AVAILABILITY_PENDING')
})

test('LOT/expiry public capacity uses sellable physical batches and active unexpired lots, not aggregate counters',async()=>{
  const tracked={...source,products:[{...source.products[0],trackingMode:'LOT'}],now:Date.parse('2026-10-14'),
    batches:[{id:'batch',productId:'pos',variantId:'variant',baseQuantity:'3',reservedBaseQuantity:'1',physicalBaseQuantity:'2',heldBaseQuantity:'0',receivedAt:'2026-10-01'}],
    lots:[{id:'lot',inventoryBatchId:'batch',status:'ACTIVE',quantity:'1.5',expiresAt:'2026-11-01'}]}
  assert.equal((await projectDirectAvailability(tracked))[0].available,1)
  assert.equal((await projectDirectAvailability({...tracked,lots:[{...tracked.lots[0],expiresAt:'2026-10-13'}]}))[0].available,0)
  assert.equal((await projectDirectAvailability({...tracked,lots:[]}))[0].available,0)
  await assert.rejects(projectDirectAvailability({...tracked,batches:[]}),{status:409})
  assert.equal((await projectDirectAvailability({...tracked,products:[{...tracked.products[0],trackingMode:'EXPIRY'}],lots:[]}))[0].available,2)
})
