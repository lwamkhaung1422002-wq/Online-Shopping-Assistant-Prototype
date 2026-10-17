import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTrackingPhone, readTrackingHistory, rememberTrackingOrder, ordersForPhone } from '../dashboard/src/services/tracking-history.js'
const token = 'a'.repeat(64)
function storage() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } }
test('phone matching follows POS normalization for local, international, Myanmar and fullwidth digits', () => {
  for (const phone of ['09 123 456 789', '+95 9 123 456 789', '0095-9-123456789', '၀၉၁၂၃၄၅၆၇၈၉', '０９１２３４５６７８９']) assert.equal(normalizeTrackingPhone(phone), '09123456789')
  assert.equal(normalizeTrackingPhone(null), '')
})
test('only the selected phone and shop can retrieve locally owned tokens', () => {
  const store = storage()
  rememberTrackingOrder(store, 'shop-a', { reference: 'mine', tracking_token: token }, '+959123456789')
  rememberTrackingOrder(store, 'shop-a', { reference: 'other', tracking_token: 'b'.repeat(64) }, '09987654321')
  assert.deepEqual(ordersForPhone(readTrackingHistory(store, 'shop-a'), '၀၉၁၂၃၄၅၆၇၈၉').map(order => order.reference), ['mine'])
  assert.deepEqual(ordersForPhone(readTrackingHistory(store, 'shop-a'), ''), [])
  assert.deepEqual(ordersForPhone(readTrackingHistory(store, 'shop-b'), '09123456789'), [])
  assert.deepEqual(ordersForPhone(readTrackingHistory(store, 'shop-a'), '09111111111'), [])
})
test('retry replaces the same order token without duplication or discarding earlier orders', () => {
  const store = storage()
  for (let index = 0; index < 15; index++) assert.equal(rememberTrackingOrder(store, 'shop', { reference: `r-${index}`, tracking_token: token }, '09123456789'), true)
  rememberTrackingOrder(store, 'shop', { reference: 'r-3', tracking_token: 'c'.repeat(64) }, '09123456789')
  const entries = readTrackingHistory(store, 'shop')
  assert.equal(entries.length, 15)
  assert.equal(entries[0].reference, 'r-3')
  assert.equal(entries[0].token, 'c'.repeat(64))
})
test('legacy private links survive, without claiming an unknown phone matches', () => {
  const store = storage()
  store.setItem('os-orders:shop', JSON.stringify([{ reference: 'old', token }, { reference: 'old', token }, { reference: 'bad', token: 'bad' }, null]))
  assert.deepEqual(readTrackingHistory(store, 'shop'), [{ reference: 'old', token, phone: '' }])
  assert.deepEqual(ordersForPhone(readTrackingHistory(store, 'shop'), '09123456789'), [])
  rememberTrackingOrder(store, 'shop', { reference: 'new', tracking_token: token }, '09123456789')
  assert.equal(readTrackingHistory(store, 'shop').at(-1).reference, 'old')
})
test('storage denial, malformed history and incomplete server replies do not break checkout', () => {
  const denied = { getItem() { throw Error('denied') }, setItem() { throw Error('denied') } }
  assert.deepEqual(readTrackingHistory(denied, 'shop'), [])
  assert.equal(rememberTrackingOrder(denied, 'shop', { reference: 'order', tracking_token: token }, '09123456789'), false)
  const store = storage()
  for (const raw of ['{broken', '{}', 'null', '[null,1,"hello"]']) { store.setItem('os-orders:shop', raw); assert.deepEqual(readTrackingHistory(store, 'shop'), []) }
  assert.equal(rememberTrackingOrder(store, 'shop', { reference: 'x' }, '09123456789'), false)
})
