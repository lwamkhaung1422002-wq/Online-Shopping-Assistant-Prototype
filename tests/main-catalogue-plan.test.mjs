import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLegacyCataloguePlan } from '../../BelleLocal POS app/functions/src/main-local/catalogue-plan.js'
import { legacyOrderView } from '../../BelleLocal POS app/functions/src/pos/history.js'
import { productSchema, normalizeOptionTree, validateVariantPath } from '../../BelleLocal POS app/functions/src/pos/product-domain.js'

test('catalogue planning preserves quantities/prices and reuses one flat color value across different sizes',()=>{
  const stockRows=[{id:'brown',type:'Elegence',size:'Size 1',color:'Brown',quantity:5,price:200,date:'2026-01-01'},{id:'blue',type:'Elegence',size:'Size 2',color:'Blue',quantity:3,price:210,date:'2026-01-02'}]
  stockRows.push({id:'brown-size-two',type:'Elegence',size:'Size 2',color:'Brown',quantity:2,price:210,date:'2026-01-02'})
  const orderRows=[{id:'older',date:'2026-01-03',paymentStatus:'unpaid',fulfillmentStatus:'reserved',total:450,items:[{id:'line',type:'Elegence',size:'Size 1',color:'Brown',quantity:1,unitPrice:500,unitCost:200,discount:50,allocations:[{stockBatchId:'brown',quantity:1,unitCost:200}]}]},{id:'latest',date:'2026-01-04',paymentStatus:'unpaid',fulfillmentStatus:'reserved',total:525,items:[{id:'line',type:'Elegence',size:'Size 1',color:'Brown',quantity:1,unitPrice:600,unitCost:200,discount:75,allocations:[{stockBatchId:'brown',quantity:1,unitCost:200}]}]}]
  const docs=(table,rows)=>rows.map(row=>({id:row.id,ref:{path:`users/UXRbRF184gcohMkl4CdS0i0rdow2/${table}/${row.id}`},data:()=>row}))
  const before=structuredClone({stockRows,orderRows}),source={snapshotHash:'fixture-hash',stocks:docs('stocks',stockRows),orders:docs('orders',orderRows)}
  const originals=orderRows.map(legacyOrderView),plan=buildLegacyCataloguePlan({source,originals,effective:originals})
  assert.equal(plan.productCount,1);assert.equal(plan.variantCount,3);assert.equal(plan.writesPerformed,false);assert.equal(plan.sharedStockAuthority,false)
  const product=plan.products[0],brown=product.variants.find(row=>row.name==='Size 1 / Brown'),blue=product.variants.find(row=>row.name==='Size 2 / Blue')
  assert.equal(brown.originalAvailable,3);assert.equal(brown.originalReserved,2);assert.equal(brown.proposedPrice,600);assert.equal(brown.priceSourceDate,'2026-01-04')
  assert.equal(blue.proposedPrice,null);assert.equal(blue.priceBasis,'owner-input-required')
  assert.ok(product.variants.every(row=>row.priceNeedsOwnerReview))
  const draft=productSchema.parse({name:product.name,price:600,cost:200,optionTree:product.optionTree})
  const tree=normalizeOptionTree(draft.optionTree)
  assert.equal(tree.values.filter(value=>value.label==='Brown').length,1)
  assert.equal(new Set(product.variants.filter(variant=>variant.name.endsWith('/ Brown')).map(variant=>variant.optionPath[1].valueId)).size,1)
  for(const variant of product.variants)assert.doesNotThrow(()=>validateVariantPath(tree,variant.optionPath))
  assert.deepEqual({stockRows,orderRows},before)
  assert.equal(JSON.stringify(plan).includes('customer'),false)
})
