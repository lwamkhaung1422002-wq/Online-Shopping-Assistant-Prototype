import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validatePosRuntime, assertPosReadOnlyRequest } from '../../BelleLocal POS app/src/features/shop-admin/editor/services/pos-runtime.js'
import { createApi } from '../../BelleLocal POS app/src/features/shop-admin/editor/shared/firebase.js'

const main = { apiUrl: 'http://127.0.0.1:5002', projectId: 'pos-shop-owner', dev: true, mainReadOnly: 'true' }
test('main source preview is explicit, development-only and bound to the dedicated API', () => {
  assert.equal(validatePosRuntime(main).readOnly, true)
  for (const change of [{ dev: false }, { projectId: 'demo-belle-online' }, { apiUrl: '' },
    { apiUrl: 'http://127.0.0.1:5001' }, { apiUrl: 'http://localhost:5002' },
    { apiUrl: 'http://127.0.0.1:5002/other' }, { apiUrl: 'http://127.0.0.1:5002/?x=1' },
    { apiUrl: 'http://user:password@127.0.0.1:5002' }, { apiUrl: 'https://example.com' }]) {
    assert.throws(() => validatePosRuntime({ ...main, ...change }))
  }
  assert.throws(() => validatePosRuntime({ ...main, mainReadOnly: undefined }))
  assert.equal(validatePosRuntime({ ...main, mainReadOnly: undefined, projectId: 'demo-belle-online', apiUrl: 'http://127.0.0.1:5001' }).readOnly, false)
})

test('every main-preview mutation is rejected before authentication or fetch', async () => {
  let authReads = 0
  const api = createApi({ configured: true, readOnly: true, auth: { get currentUser() { authReads++; throw new Error('Auth must not be reached') } } })
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'post']) {
    await assert.rejects(api('admin/history/orders/original/events', {}, { admin: true, method }), { status: 405 })
  }
  await assert.rejects(api('admin/history', {}, { admin: true, method: 'GET' }), { status: 405 })
  assert.equal(authReads, 0)
  assert.doesNotThrow(() => assertPosReadOnlyRequest(true, 'GET', undefined))
  assert.doesNotThrow(() => assertPosReadOnlyRequest(false, 'POST', {}))
})

test('main-preview GET uses the current owner token and returns source values unchanged', async (t) => {
  const source = { original: { id: 'source-order', total: 34500, paymentStatus: 'unpaid' } }
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options })
    return { ok: true, json: async () => source }
  })
  let tokenReads = 0
  const api = createApi({ configured: true, readOnly: validatePosRuntime(main).readOnly,
    apiUrl: main.apiUrl, shopId: 'belle-online',
    auth: { currentUser: { getIdToken: async () => { tokenReads++; return 'fictional-owner-token' } } } })
  assert.deepEqual(await api('admin/history/orders/source-order', undefined, { admin: true }), source)
  assert.equal(tokenReads, 1)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'http://127.0.0.1:5002/belle-online/admin/history/orders/source-order')
  assert.equal(requests[0].options.method, 'GET')
  assert.equal(requests[0].options.headers.Authorization, 'Bearer fictional-owner-token')
  assert.equal(requests[0].options.body, undefined)
})
