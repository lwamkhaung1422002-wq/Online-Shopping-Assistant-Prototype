import test from 'node:test'
import assert from 'node:assert/strict'
import {preparePurchaseReceiptLines,purchaseReceiptLocation} from '../../BelleLocal POS app/functions/src/pos/purchase-receipt-domain.js'
import {convertedBaseQuantity} from '../../BelleLocal POS app/functions/src/pos/quantity.js'

const products=[{id:'product',units:[{unitId:'case',isBase:false,canPurchase:false}]}],units=[{id:'case',precision:3}]
const original=()=>({id:'purchase',status:'ordered',deliveryCost:500,paidAmount:1000,paymentStatus:'partial',items:[{id:'line',productId:'product',productName:'Source product',unitId:'case',quantity:12,baseQuantity:'12',enteredQuantity:'2',conversionFactor:'6',receivedQuantity:0,receivedBaseQuantity:'0',unitCost:1200,plannedUnitCost:1200,lineTotal:2400}]})

test('Purchase confirmation changes financial price but preserves the loaded old price for batch cost and the immutable planned price',()=>{
  const purchase=original(),before=structuredClone(purchase),body={items:[{purchaseItemId:'line',quantity:0.5,actualUnitCost:1500}]}
  assert.throws(()=>preparePurchaseReceiptLines(purchase,body,products,units),/Confirm the price change/)
  const plan=preparePurchaseReceiptLines(purchase,{...body,confirmPriceChanges:true},products,units)
  assert.equal(plan.plans[0].baseQuantity,'3');assert.equal(plan.plans[0].baseUnitCost,200);assert.equal(plan.items[0].unitCost,1500);assert.equal(plan.items[0].plannedUnitCost,1200);assert.equal(plan.items[0].lineTotal,3000);assert.equal(plan.total,3500);assert.equal(plan.status,'partially_received');assert.deepEqual(purchase,before)
  // Existing purchase-unit snapshots are still receivable even when the
  // current product configuration disabled new purchases in that unit.
  assert.equal(products[0].units[0].canPurchase,false)
})

test('Purchase conversion rounds where capability receipt rejects excess result precision, with last duplicate and unknown-item source behavior',()=>{
  const purchase=original();purchase.items[0]={...purchase.items[0],baseQuantity:'1',quantity:1,conversionFactor:'0.333333'}
  assert.throws(()=>convertedBaseQuantity('0.003','0.333333'),/Converted base quantity/)
  const plan=preparePurchaseReceiptLines(purchase,{items:[{purchaseItemId:'unknown',quantity:500},{purchaseItemId:'line',quantity:2},{purchaseItemId:'line',quantity:0.003}]},products,units)
  assert.equal(plan.plans.length,1);assert.equal(plan.plans[0].enteredQuantity,'0.003');assert.equal(plan.plans[0].baseQuantity,'0.001');assert.equal(plan.items[0].receivedBaseQuantity,'0.001')
  const zero=preparePurchaseReceiptLines(purchase,{items:[{purchaseItemId:'unknown',quantity:1}]},products,units);assert.equal(zero.plans.length,0);assert.equal(zero.total,2900);assert.equal(zero.status,'partially_received')
})

test('Source receipt increments rounded compatibility quantities per receipt rather than rounding the cumulative exact received quantity',()=>{
  const purchase=original();purchase.items[0]={...purchase.items[0],baseQuantity:'0.8',quantity:1,conversionFactor:'1',enteredQuantity:'0.8',lineTotal:960}
  const first=preparePurchaseReceiptLines(purchase,{items:[{purchaseItemId:'line',quantity:0.4}]},products,units)
  assert.equal(first.items[0].receivedQuantity,0);assert.equal(first.items[0].receivedBaseQuantity,'0.4');assert.equal(first.status,'partially_received')
  const second=preparePurchaseReceiptLines({...purchase,status:first.status,items:first.items},{items:[{purchaseItemId:'line',quantity:0.4}]},products,units)
  assert.equal(second.items[0].receivedQuantity,0);assert.equal(second.items[0].receivedBaseQuantity,'0.8');assert.equal(second.status,'received');assert.equal(second.total,1460)
})

test('Receipt planning guards current precision, exact remainder, closed status and late invalid items without mutating the original purchase',()=>{
  const purchase=original(),before=structuredClone(purchase)
  assert.throws(()=>preparePurchaseReceiptLines(purchase,{items:[{purchaseItemId:'line',quantity:0.0001}]},products,units),/at most 3 decimal/)
  assert.throws(()=>preparePurchaseReceiptLines(purchase,{items:[{purchaseItemId:'line',quantity:3}]},products,units),/exceeds remaining/)
  assert.throws(()=>preparePurchaseReceiptLines({...purchase,status:'received'},{items:[{purchaseItemId:'line',quantity:1}]},products,units),/not open/)
  const later={...purchase,items:[...purchase.items,{...purchase.items[0],id:'late',productId:'missing'}]},laterBefore=structuredClone(later)
  assert.throws(()=>preparePurchaseReceiptLines(later,{items:[{purchaseItemId:'line',quantity:0.5}]},products,units),/requires reconciliation/)
  assert.deepEqual(later,laterBefore);assert.deepEqual(purchase,before)
  const large={...purchase,deliveryCost:0,paidAmount:0,items:[{...purchase.items[0],quantity:2147483647,baseQuantity:'2147483647.499',enteredQuantity:'2147483647.499',conversionFactor:'1',unitCost:0,plannedUnitCost:0,lineTotal:0}]}
  const exact=preparePurchaseReceiptLines(large,{items:[{purchaseItemId:'line',quantity:'2147483647.499'}]},products,units)
  assert.equal(exact.items[0].receivedQuantity,2147483647);assert.equal(exact.items[0].receivedBaseQuantity,'2147483647.499');assert.equal(exact.status,'received')
})

test('Source location/tracking preconditions keep expired lots in reasoned quarantine and require exact serial counts, without claiming uniqueness or tracked writers',()=>{
  const locations=[{id:'sell',type:'SELLABLE',isActive:true},{id:'quarantine',type:'QUARANTINE',isActive:true},{id:'inactive',type:'SELLABLE',isActive:false}],now=Date.parse('2026-10-11T00:00:00Z'),base=preparePurchaseReceiptLines(original(),{items:[{purchaseItemId:'line',quantity:0.5}]},products,units).plans[0]
  assert.equal(purchaseReceiptLocation(base,locations,'sell',undefined,now).id,'sell')
  assert.throws(()=>purchaseReceiptLocation({...base,input:{...base.input,locationId:'inactive'}},locations,'sell',undefined,now),/location is invalid/)
  assert.throws(()=>purchaseReceiptLocation({...base,input:{...base.input,serials:[{serial:'unexpected'}]}},locations,'sell',undefined,now),/Serial details are not supported/)
  const tracked={...base,product:{...base.product,trackingMode:'LOT',capabilities:{'inventory.expiry':true}}}
  assert.throws(()=>purchaseReceiptLocation(tracked,locations,'sell',undefined,now),/Lot details are required/)
  assert.throws(()=>purchaseReceiptLocation({...tracked,input:{...tracked.input,lot:{lotNumber:'A'}}},locations,'sell',undefined,now),/Expiry date is required/)
  const expired={...tracked,input:{...tracked.input,lot:{lotNumber:'A',expiresAt:new Date(now)}}}
  assert.throws(()=>purchaseReceiptLocation(expired,locations,'sell','Expired supply',now),/only be received into quarantine/)
  assert.throws(()=>purchaseReceiptLocation(expired,locations,'quarantine',undefined,now),/reason note/)
  assert.equal(purchaseReceiptLocation(expired,locations,'quarantine','Expired supply',now).id,'quarantine')
  const serial={...base,product:{...base.product,trackingMode:'SERIAL'}}
  assert.throws(()=>purchaseReceiptLocation({...serial,input:{...serial.input,serials:[{serial:'one'}]}},locations,'sell',undefined,now),/Exact serial details/)
  assert.equal(purchaseReceiptLocation({...serial,input:{...serial.input,serials:[{serial:'one'},{serial:'two'},{serial:'three'}]}},locations,'sell',undefined,now).id,'sell')
})
