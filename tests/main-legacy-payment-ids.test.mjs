import test from 'node:test'
import assert from 'node:assert/strict'
import {legacyPaymentOrderIds,projectLegacyCash} from '../../BelleLocal POS app/functions/src/pos/legacy-cash-projection.js'

test('legacy receipt IDs join string document IDs without altering saved records or counting allocations twice',()=>{
  const orderId=1769852491583
  const snapshot={report:{range:{from:'2026-01-31',to:'2026-01-31'}},orders:[{id:String(orderId),date:'2026-01-31',total:100,paid:true,received:true,paymentId:'receipt',items:[]}],receipts:[],payments:[
    {id:'receipt',sourcePath:'fixture/payments/receipt',date:'2026-01-31',createdAt:'2026-02-01',orderId,amount:100,method:'Other'},
    {id:'cod',sourcePath:'fixture/payments/cod',date:'2026-01-31',orderIds:[orderId,'00123'],allocations:[{orderId,amount:50},{orderId:'00123',amount:25}],amount:75,method:'COD'},
  ]}
  const before=structuredClone(snapshot),projection=projectLegacyCash(snapshot)
  assert.equal(projection.received,175)
  assert.deepEqual(projection.receipts.map(row=>row.orderIds),[[String(orderId)],[String(orderId),'00123']])
  assert.equal(projection.receipts[0].date,'2026-01-31')
  assert.equal(projection.warnings.filter(row=>row.type==='orphan-payment'&&row.paymentId==='receipt').length,0)
  assert.deepEqual(snapshot,before)
  assert.deepEqual(legacyPaymentOrderIds({orderId:0}),['0'])
})

test('ambiguous legacy order references still require reconciliation instead of being coerced',()=>{
  for(const orderId of [NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1,-1,true,{},[]])assert.throws(()=>legacyPaymentOrderIds({orderId}),error=>error.code==='HISTORY_RECONCILIATION_REQUIRED')
  for(const orderIds of ['123',{},[1.5],[true],[{}]])assert.throws(()=>legacyPaymentOrderIds({orderIds}),error=>error.code==='HISTORY_RECONCILIATION_REQUIRED')
  assert.deepEqual(legacyPaymentOrderIds({orderId:'00123'}),['00123'])
})

test('pre-amount paid receipts reuse original Belle amounts and retain inactive records as audit exclusions',()=>{
  const snapshot={report:{range:{}},orders:[{id:'123',date:'2026-01-31',total:100,paid:true,received:true,paymentId:'old',items:[]},{id:'124',date:'2026-01-31',total:200,paid:false,received:false,items:[]}],receipts:[],payments:[
    {id:'old',sourcePath:'fixture/old',orderId:123,date:'2026-01-31',method:'Other'},
    {id:'refunded',sourcePath:'fixture/refunded',orderId:123,date:'2026-01-31',method:'Other',refunded:true},
    {id:'unpaid',sourcePath:'fixture/unpaid',orderId:124,date:'2026-01-31',method:'Other'},
    {id:'orphan',sourcePath:'fixture/orphan',orderId:125,date:'2026-01-31',method:'Other'},
  ]}
  const before=structuredClone(snapshot),cash=projectLegacyCash(snapshot)
  assert.equal(cash.received,100)
  assert.equal(cash.receipts[0].amountBasis,'original-belle-linked-paid-order')
  assert.deepEqual(cash.excludedReceipts.map(row=>row.sourcePaymentId),['refunded','unpaid','orphan'])
  assert.ok(cash.excludedReceipts.every(row=>row.amount===null))
  assert.deepEqual(snapshot,before)
})

test('amountless overlay, refund, partial and COD receipts cannot infer an amount from an order',()=>{
  const base={report:{range:{}},orders:[{id:'123',date:'2026-01-31',total:100,paid:true,received:true,paymentId:'old',items:[]}],receipts:[],payments:[]}
  for(const attributes of [{source:'legacy-overlay'},{type:'refund'},{scope:'refund'},{scope:'cod-settlement'}])assert.throws(()=>projectLegacyCash({...base,payments:[{id:'old',sourcePath:'fixture/old',date:'2026-01-31',orderId:123,method:'Other',...attributes}]}),error=>error.code==='HISTORY_RECONCILIATION_REQUIRED')
  assert.throws(()=>projectLegacyCash({...base,orders:[{...base.orders[0],paymentStatus:'partial',amountPaid:25,balanceDue:75}],payments:[{id:'old',sourcePath:'fixture/old',date:'2026-01-31',orderId:123,method:'Other'}]}),error=>error.code==='HISTORY_RECONCILIATION_REQUIRED')
})
