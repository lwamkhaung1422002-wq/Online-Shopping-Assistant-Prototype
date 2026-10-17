import test from 'node:test'
import assert from 'node:assert/strict'
import { addCartItem, cleanCart } from '../dashboard/shared/cart.js'
import { suggestFromGuide, validateGuide } from '../dashboard/shared/catalog.js'
import { readFirebaseConfiguration } from '../dashboard/shared/firebase.js'
import { validateImage } from '../dashboard/shared/images.js'

test('cart enforces total variant quantity, item limits and discards corrupted storage', () => {
  const item = { variant_id: 'test', quantity: 1, measurements: {} }
  const cart = addCartItem([], item, 2)
  assert.equal(addCartItem(cart, item, 2)[0].quantity, 2)
  assert.throws(() => addCartItem(cart, { ...item, quantity: 2 }, 2), /available/)
  assert.throws(() => addCartItem([], { ...item, quantity: 1.5 }, 2), /whole/)
  assert.throws(() => addCartItem([], { ...item, quantity: -1 }, 2), /whole/)
  assert.equal(cleanCart([null, { ...item, quantity: 1000 }, item]).length, 1)
  assert.deepEqual(cleanCart({}), [])
})
test('dynamic size guides preserve measurement scoring without product-specific IDs', () => {
  const guide = { name: 'Custom guide', fields: [{ key: 'bust', label: 'Bust' }, { key: 'weight', label: 'Weight' }],
    sizes: [{ id: 'S', label: 'Small', bust: [30, 34], weight: [90, 110] }, { id: 'M', label: 'Medium', bust: [34, 38], weight: [110, 140] }] }
  validateGuide(guide)
  assert.equal(suggestFromGuide(guide, { bust: 36, weight: 125 }).suggested, 'M')
  assert.equal(suggestFromGuide(guide, {}).suggested, null)
  assert.equal(suggestFromGuide(guide, { bust: -1 }).suggested, null)
  assert.throws(() => validateGuide({ ...guide, sizes: [{ id: 'X', label: 'X', weight: [120, 90] }] }), /range/)
  assert.throws(() => validateGuide({ ...guide, fields: [{ key: 'bust', label: 'Bust' }, { key: 'bust', label: 'Duplicate' }] }), /unique/)
  assert.throws(() => validateGuide({ ...guide, fields: [{ key: 'id', label: 'Measurement' }] }), /reserved/)
})
test('image validation rejects SVG, oversized and empty files', () => {
  validateImage({ type: 'image/webp', size: 1000 })
  assert.throws(() => validateImage({ type: 'image/svg+xml', size: 100 }), /JPEG/)
  assert.throws(() => validateImage({ type: 'image/png', size: 6 * 1024 * 1024 }), /5 MB/)
  assert.throws(() => validateImage({ type: 'image/png', size: 0 }), /5 MB/)
})
test('Firebase preview is disconnected and local tests cannot point at production', () => {
  assert.equal(readFirebaseConfiguration({}).configured, false)
  const base = { VITE_FIREBASE_API_URL: 'http://127.0.0.1:5001/api', VITE_FIREBASE_PROJECT_ID: 'pos-shop-owner', VITE_FIREBASE_API_KEY: 'test', VITE_FIREBASE_APP_ID: 'test' }
  assert.throws(() => readFirebaseConfiguration(base), /demo/)
  assert.throws(() => readFirebaseConfiguration({ ...base, VITE_FIREBASE_API_URL: 'http://example.com/api' }), /Invalid/)
  assert.throws(() => readFirebaseConfiguration({ ...base, VITE_SHOP_ID: 'users/owner' }), /Invalid/)
})
