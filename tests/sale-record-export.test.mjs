import test from 'node:test'
import assert from 'node:assert/strict'
import {saleRecordsCsv} from '../../BelleLocal POS app/src/features/retails/lib/saleRecordExport.js'
test('Sale record CSV keeps source identities, paid state and exact totals while escaping separators, quotes, Burmese and formula text',()=>{
 const rows=[{source:'belle-history',sourceOrderId:'same',date:'2026-07-23',customerName:'=SUM(1,2)',fulfillmentStatus:'reserved',paymentStatus:'paid',total:34500},{source:'retails',sourceOrderId:'same',orderNumber:'00012',date:'2026-10-13',customerName:'ဝယ်သူ "Name"\nSecond line',fulfillmentStatus:'completed',paymentStatus:'partial',total:2000}]
 const before=structuredClone(rows),csv=saleRecordsCsv(rows)
 assert.ok(csv.startsWith('\uFEFF"Source","Order number"'));assert.ok(csv.includes('"belle-history","same","same","2026-07-23","\'=SUM(1,2)"'));assert.ok(csv.includes('"ဝယ်သူ ""Name""\nSecond line"'));assert.ok(csv.includes('"completed","partial","2000"'));assert.deepEqual(rows,before)
 assert.equal(saleRecordsCsv([]).split('\r\n').length,2)
})
