import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { createDirectContactsClient } from '../../BelleLocal POS app/src/features/firebase-direct/contacts-client.js'
import { MAIN_OWNER_UID } from '../../BelleLocal POS app/src/features/firebase-direct/content-model.js'
import { digest } from '../../BelleLocal POS app/src/shared/pos-domain/mutation.js'
import { utf8ByteLength } from '../../BelleLocal POS app/src/shared/pos-domain/bytes.js'
import { createHash } from '../../BelleLocal POS app/src/shared/pos-domain/crypto.js'
import { createHash as nodeHash } from 'node:crypto'
const require = createRequire(new URL('../../BelleLocal POS app/package.json', import.meta.url)), sdk = require('firebase/firestore')
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing')
if (process.env.DIRECT_FIRESTORE_EMULATOR !== '127.0.0.1:8088') throw Error('Use the isolated direct emulator.')
const environment = await initializeTestEnvironment({ projectId: 'demo-belle-direct-contacts', firestore: { host: '127.0.0.1', port: 8088, rules: await readFile(new URL('../../BelleLocal POS app/config/firebase/firestore.direct.rules', import.meta.url), 'utf8') } })
test.after(() => environment.cleanup())
const root = 'onlineShopV2/belle-online', owner = () => environment.authenticatedContext(MAIN_OWNER_UID).firestore()
const client = db => createDirectContactsClient({ db, auth: { currentUser: { uid: MAIN_OWNER_UID, displayName: 'Demo owner' } }, sdk })
const ref = (db, table, id) => sdk.doc(db, `${root}/${table}/${id}`)
async function fixture(enabled = true) {
  await environment.clearFirestore()
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore(), batch = sdk.writeBatch(db)
    batch.set(ref(db, 'direct_runtime', 'main'), { pos_contacts_enabled: enabled, backend_writers_stopped: true, original_writers_stopped: true })
    batch.set(sdk.doc(db, `users/${MAIN_OWNER_UID}/orders/original`), { total: 34500, paymentStatus: 'unpaid', customer: { name: 'Original buyer' } })
    await batch.commit()
  })
}
const original = async db => digest((await sdk.getDoc(sdk.doc(db, `users/${MAIN_OWNER_UID}/orders/original`))).data())
const supplier = invoiceNumber => ({ name: 'Demo supplier', phone: '09900000000', deliveryRecord: { invoiceNumber, deliveryName: 'Delivery service', deliveryPhone: '09900000001', receivedAt: '2026-10-14', dueAt: '2026-10-20', amount: 5000 } })
test('actual SDK customer routes validate/save/edit/search/delete and immutable audit without original writes; read-only preview still reads while edits are disabled', async () => {
  await fixture(); const db = owner(), call = client(db), before = await original(db)
  const { customer } = await call('admin/pos/customers', { name: '  Demo buyer  ', phone: '09912345678', email: 'BUYER@example.com' })
  assert.equal(customer.name, 'Demo buyer'); assert.equal(customer.email, 'buyer@example.com')
  await call(`admin/pos/customers/${customer.id}`, { city: 'Yangon' }, { method: 'PATCH' })
  assert.equal((await call(`admin/pos/customers/${customer.id}`)).customer.city, 'Yangon')
  assert.equal((await call('admin/pos/customers?search=099123')).totalCount, 1)
  assert.equal((await call('admin/pos/customers?includeStats=true')).customers[0].hasHistory, false)
  await call(`admin/pos/customers/${customer.id}`, undefined, { method: 'DELETE' })
  assert.equal((await call('admin/pos/customers')).totalCount, 0)
  const audits = (await sdk.getDocs(sdk.collection(db, `${root}/pos_audit`))).docs
  assert.equal(audits.length, 3)
  await assertFails(sdk.updateDoc(audits[0].ref, { actorId: 'changed' }))
  assert.equal(await original(db), before)
  await fixture(false)
  assert.equal((await call('admin/pos/customers')).totalCount, 0)
  await assert.rejects(call('admin/pos/customers', { name: 'Unavailable' }), { status: 409 })
})
test('current customer invoice history/statistics/report retain deletion guard and price-group state with original records untouched', async () => {
  await fixture(); const db = owner(), call = client(db)
  const { customer } = await call('admin/pos/customers', { name: 'Invoice buyer' })
  await environment.withSecurityRulesDisabled(async context => {
    await sdk.setDoc(ref(context.firestore(), 'pos_orders', 'sale'), { id: 'sale', customerId: customer.id, orderNumber: '00001', createdAt: '2026-10-14', fulfillmentStatus: 'completed', subtotal: 500, discount: 0, total: 500, items: [] })
    await sdk.updateDoc(ref(context.firestore(), 'pos_customers', customer.id), { priceGroupId: 'group' })
  })
  const customers = await call('admin/pos/customers?includeStats=true')
  assert.equal(customers.customers[0].visitCount, 1); assert.equal(customers.customers[0].totalAmount, 500)
  await call(`admin/pos/customers/${customer.id}`, { notes: 'Updated' }, { method: 'PATCH' })
  assert.equal((await call(`admin/pos/customers/${customer.id}`)).customer.priceGroupId, 'group')
  assert.equal((await call(`admin/pos/customers/${customer.id}/transaction-report`)).customer.id, customer.id)
  await assert.rejects(call(`admin/pos/customers/${customer.id}`, undefined, { method: 'DELETE' }), { status: 409 })
  assert.equal((await sdk.getDoc(ref(db, 'pos_customers', customer.id))).exists(), true)
})
test('supplier invoice creates trusted receiver and dates, rejects duplicate under contention, edits/cancels credit and retains cancelled records', async () => {
  await fixture(); const db = owner(), call = client(db), before = await original(db)
  const outcomes = await Promise.allSettled([call('admin/pos/suppliers', supplier('INV-1')), call('admin/pos/suppliers', supplier('INV-1'))])
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1, JSON.stringify(outcomes.map(row => row.reason?.message || 'saved')))
  assert.equal(outcomes.filter(row => row.status === 'rejected' && row.reason.status === 409).length, 1)
  const record = outcomes.find(row => row.status === 'fulfilled').value.record
  assert.equal(record.receiverName, 'Demo owner'); assert.equal(record.receivedAt, '2026-10-14T00:00:00.000Z')
  const detail = await call(`admin/pos/supplier-delivery-records/${record.id}`)
  assert.equal(detail.record.invoiceStatus, 'Credit'); assert.equal(detail.record.remaining, 5000)
  await call(`admin/pos/supplier-delivery-records/${record.id}`, supplier('INV-1'), { method: 'PATCH' })
  const invoices = await call('admin/pos/supplier-delivery-invoices')
  assert.equal(invoices.records.length, 1)
  await call(`admin/pos/supplier-delivery-records/${record.id}/cancel`, { reason: 'Not supplied' })
  assert.equal((await call(`admin/pos/supplier-delivery-records/${record.id}`)).record.invoiceStatus, 'Cancelled')
  await assert.rejects(call(`admin/pos/supplier-delivery-records/${record.id}`, supplier('INV-1'), { method: 'PATCH' }), { status: 400 })
  assert.equal(await original(db), before)
})
test('Rules require owner and write fence, deny original/private outsider access and archive mutation; browser hash/UTF-8 boundaries equal Node', async () => {
  await fixture(); const db = owner()
  const outsider = createDirectContactsClient({ db, auth: { currentUser: { uid: 'outsider' } }, sdk })
  await assert.rejects(outsider('admin/pos/customers', { name: 'Denied' }), { status: 403 })
  await assertFails(sdk.setDoc(ref(environment.unauthenticatedContext().firestore(), 'pos_customers', 'guest'), { name: 'Denied' }))
  await assertFails(sdk.setDoc(ref(db, 'pos_customers', 'unfenced'), { id: 'unfenced', shopId: 'belle-online', name: 'Denied' }))
  await assertFails(sdk.updateDoc(sdk.doc(db, `users/${MAIN_OWNER_UID}/orders/original`), { total: 1 }))
  const value = 'Belle မြန်မာ 😀'
  assert.equal(utf8ByteLength(value), Buffer.byteLength(value))
  assert.equal(createHash('sha256').update(value).digest('hex'), nodeHash('sha256').update(value).digest('hex'))
})
