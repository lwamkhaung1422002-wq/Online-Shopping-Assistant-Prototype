import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareCheckoutFrame,frozenFrameSlices } from '../../BelleLocal POS app/src/features/firebase-direct/checkout-frame-model.js'
import { directStockScope } from '../../BelleLocal POS app/src/features/firebase-direct/availability-model.js'
import { prepareFrozenBooking } from '../dashboard/shared/frozen-booking.js'
const scope=await directStockScope('pos','v')
function source(){return {posts:[{id:'post',name:'Elegence',status:'published',variants:[{id:'brown',color:'Brown',size:'1',active:true},{id:'alias',color:'Pink',size:'1',active:true}]}],
  bindings:['brown','alias'].map(id=>({id,public_product_id:'post',public_variant_id:id,pos_product_id:'pos',pos_variant_id:'v',scope_key:scope})),products:[{id:'pos',trackingMode:'NONE',variants:[{id:'v',price:34500}]}],locations:[],lots:[],
  balances:[{id:scope,productId:'pos',variantId:'v',onHand:'3.5',reserved:'0.5',version:1}],batches:[
    {id:'old',productId:'pos',variantId:'v',scopeKey:scope,baseQuantity:'1.5',reservedBaseQuantity:'0.5',physicalBaseQuantity:'1.5',heldBaseQuantity:'0.5',consumedBaseQuantity:'0',unitCost:12000,receivedAt:'2026-10-12',legacySource:{fifoDate:'2026-07-23',batchId:'old'}},
    {id:'new',productId:'pos',variantId:'v',scopeKey:scope,baseQuantity:'2',reservedBaseQuantity:'0',physicalBaseQuantity:'2',heldBaseQuantity:'0',consumedBaseQuantity:'0',unitCost:13000,receivedAt:'2026-10-13',costBasisQuantity:'3',costBasisValue:'40001'}]}}
async function fixture(){const prepared=await prepareCheckoutFrame(source(),{version:1,contentVersion:2,now:Date.parse('2026-10-14T00:00:00Z')});return {...prepared,book:{schema:'fifo-frame-v1',checkout_enabled:true,cursors:prepared.cursors,quotes:prepared.quotes,delivery_fee:0}}}
test('public FIFO frame retains exact existing rights and immutable private transferred-cost basis; alias scopes do not create stock',async()=>{
  const prepared=await fixture()
  assert.equal(Object.keys(prepared.frame.scopes).length,1);assert.equal(prepared.frame.scopes[scope].capacity,3)
  const text=JSON.stringify({frame:prepared.frame,quotes:prepared.quotes})
  assert.equal(text.includes('unitCost'),false);assert.equal(text.includes('costBasisValue'),false)
  const slices=frozenFrameSlices(prepared.frame,scope,0,2,prepared.bases)
  assert.deepEqual(slices.map(row=>[row.inventoryBatchId,row.baseQuantity,row.unitCost]),[['old','1',12000],['new','1',13000]])
  assert.equal(slices[1].costValue,'13333.666666667')
  const changed=source();changed.batches[0].unitCost=99999
  assert.equal(frozenFrameSlices(prepared.frame,scope,0,1,prepared.bases)[0].unitCost,12000)
  assert.throws(()=>frozenFrameSlices(prepared.frame,scope,0,4,prepared.bases),{status:409})
})
test('frozen booking aggregates aliases, uses POS prices, validates stock and produces twenty sealed price/quantity-prefix chunks',async()=>{
  const prepared=await fixture(),input={items:[{variant_id:'brown',quantity:1,measurements:{}},{variant_id:'alias',quantity:2,measurements:{weight:100}}]}
  const order=prepareFrozenBooking(input,prepared.book,prepared.frame)
  assert.equal(order.total,103500);assert.equal(order.cursors[scope],3);assert.equal(Object.keys(order.groups).length,1)
  assert.deepEqual(order.chunks.map(row=>row.footer_quantity),Array(20).fill(3));assert.deepEqual(order.chunks.map(row=>row.footer_amount),Array(20).fill(103500))
  assert.throws(()=>prepareFrozenBooking({items:[{variant_id:'brown',quantity:4,measurements:{}}]},prepared.book,prepared.frame),{status:409})
  assert.equal(prepared.book.cursors[scope],0)
})
test('forty-row prefix contract preserves distinct groups and every line without trusting client monetary fields',async()=>{
  const prepared=await fixture(),quotes={},scopes={},cursors={},items=[]
  for(let index=0;index<40;index++){const id=`choice-${index}`,key=String(index).padStart(64,'0');quotes[id]={...prepared.quotes.brown,variant_id:id,scope_key:key};scopes[key]={...prepared.frame.scopes[scope],capacity:2};cursors[key]=0;items.push({variant_id:id,quantity:1,measurements:{},unit_price:1})}
  const result=prepareFrozenBooking({items},{...prepared.book,quotes,cursors},{...prepared.frame,scopes})
  assert.equal(result.items.length,40);assert.deepEqual(result.chunks.map(row=>row.items.length),Array(20).fill(2));assert.equal(result.total,1380000)
  assert.deepEqual(result.chunks.map(row=>row.footer_amount),Array.from({length:20},(_,i)=>(i+1)*69000))
})
