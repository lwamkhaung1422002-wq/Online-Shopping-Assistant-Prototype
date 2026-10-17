import test from 'node:test'
import assert from 'node:assert/strict'
import { productOffer, variantOffer } from '../dashboard/shared/product-offer.js'
test('real percentage and fixed discounts compare against the same resolved variant', () => {
  assert.deepEqual(variantOffer({ price: 800, original_price: 1000 }), { price: 800, originalPrice: 1000, saving: 200, percent: 20 })
  assert.equal(variantOffer({ price: 39500, original_price: 44500 }).percent, 11.2)
  assert.equal(variantOffer({ price: 0, original_price: 1000 }).percent, 100)
})
test('non-discounted/absent/malformed comparison prices do not create sale claims', () => {
  for (const original_price of [undefined, null, 'bad', 0, -1, 800, 500]) assert.equal(variantOffer({ price: 800, original_price }).saving, 0)
})
test('color selection and mixed variant prices never cross out another variant price', () => {
  const product = { variants: [
    { active: true, color: 'Red', price: 900, original_price: 1000 },
    { active: true, color: 'Red', price: 800 },
    { active: true, color: 'Black', price: 700, original_price: 1000 },
    { active: false, color: 'Black', price: 100, original_price: 1000 },
  ] }
  assert.equal(productOffer(product, 'Red').saving, 0)
  assert.equal(productOffer(product, 'Black').percent, 30)
  assert.equal(productOffer(product).price, 700)
})
