import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareDirectReservation } from '../../BelleLocal POS app/src/features/firebase-direct/reservation-model.js'
import { directStockScope } from '../../BelleLocal POS app/src/features/firebase-direct/availability-model.js'
import { Decimal, storedQuantity } from '../../BelleLocal POS app/functions/src/pos/quantity.js'
import { Decimal as BrowserDecimal, storedQuantity as browserStoredQuantity } from '../../BelleLocal POS app/src/shared/pos-domain/quantity.js'
import { batchValue } from '../../BelleLocal POS app/functions/src/pos/batch-valuation-domain.js'
const scope = await directStockScope('pos', 'v'), stamp = '2026-10-14T00:00:00.000Z', now = Date.parse(stamp)
const input = { productId: 'pos', variantId: 'v', sourceType: 'Order', sourceId: 'one', actorUid: 'owner', action: 'reserve', quantity: '1.5' }
function fixture() {
  const batch = (id, quantity, cost, receivedAt) => ({ id, productId: 'pos', variantId: 'v', scopeKey: scope, baseQuantity: quantity, reservedBaseQuantity: '0', physicalBaseQuantity: quantity, heldBaseQuantity: '0', consumedBaseQuantity: '0', unitCost: cost, receivedAt })
  return { products: [{ id: 'pos', trackingMode: 'NONE', variants: [{ id: 'v', price: 34500 }] }], locations: [], lots: [], settings: {},
    batches: [batch('new', '1.25', 200, '2026-10-13'), { ...batch('old', '0.75', 100, '2026-10-12'), legacySource: { fifoDate: '2026-07-23', batchId: 'original-1' } }],
    balances: [{ id: scope, productId: 'pos', variantId: 'v', onHand: '2', reserved: '0', version: 1 }] }
}
const plan = (source, body = input, previous) => prepareDirectReservation({ input: body, source, previous, reservationId: 'reservation', stamp, now })
function apply(source, prepared) {
  return { ...source, batches: source.batches.map(row => ({ ...row, ...prepared.batchWrites.find(write => write.id === row.id)?.data })),
    balances: source.balances.map(row => ({ ...row, ...prepared.balanceWrites.find(write => write.id === row.id)?.data })) }
}
test('server and browser share one exact quantity/valuation implementation; direct FIFO freezes original source cost without mutating input', async () => {
  assert.equal(Decimal, BrowserDecimal); assert.equal(storedQuantity, browserStoredQuantity)
  const source = fixture(), before = structuredClone(source), reserved = await plan(source)
  assert.deepEqual(source, before)
  assert.deepEqual(reserved.result.allocations.map(row => [row.inventoryBatchId, row.baseQuantity, row.cost]), [['old', '0.75', '75'], ['new', '0.75', '150']])
  assert.equal(reserved.result.totalCost, '225'); assert.equal(reserved.balanceWrites[0].data.reserved, '1.5')
  assert.ok(!('id' in reserved.balanceWrites[0].data))
  await assert.rejects(plan(source, { ...input, quantity: '3' }), { status: 409 })
})
test('resize/release/consume maintain physical and completed compatibility counters and frozen disabled ledger', async () => {
  let source = fixture(); source.settings.ledgerEnabled = false
  const reserved = await plan(source); source = apply(source, reserved)
  assert.deepEqual(source.balances[0].sourceLedger, { onHand: '2', reserved: '0', version: 1 })
  const resized = await plan(source, { ...input, quantity: '1' }, reserved.result); source = apply(source, resized)
  assert.equal(resized.result.totalCost, '125')
  const released = await plan(source, { ...input, action: 'release', quantity: '0' }, resized.result)
  assert.equal(released.balanceWrites[0].data.reserved, '0')
  const consumed = await plan(source, { ...input, action: 'consume', quantity: '0' }, resized.result)
  assert.equal(consumed.balanceWrites[0].data.onHand, '1'); assert.equal(consumed.balanceWrites[0].data.reserved, '0')
  assert.deepEqual(consumed.balanceWrites[0].data.sourceLedger, { onHand: '2', reserved: '0', version: 1 })
  assert.deepEqual(consumed.batchWrites.find(row => row.id === 'old').data, { baseQuantity: '0.75', quantity: 1, reservedBaseQuantity: '0.75', reservedQuantity: 1, physicalBaseQuantity: '0', heldBaseQuantity: '0', consumedBaseQuantity: '0.75', updatedAt: stamp })
  await assert.rejects(plan(apply(source, consumed), { ...input, action: 'consume', quantity: '0' }, consumed.result), { status: 409 })
  await assert.rejects(plan(source, input, { ...resized.result, sourceId: 'wrong' }), { status: 409 })
})
test('exact transferred basis is preserved separately from rounded cost and LOT/expiry uses shared FEFO and consumption', async () => {
  let source = fixture()
  source.batches[1] = { ...source.batches[1], costBasisQuantity: '3', costBasisValue: '10', unitCost: 3 }
  const reserved = await plan(source, { ...input, quantity: '0.75' })
  assert.equal(reserved.result.allocations[0].cost, '2.25'); assert.equal(reserved.result.allocations[0].costValue, '2.5')
  assert.equal(batchValue(source.batches[1], new Decimal('0.75')).toString(), '2.5')
  source = fixture(); source.products[0].trackingMode = 'LOT'
  source.lots = [{ id: 'later', productId: 'pos', inventoryBatchId: 'old', status: 'ACTIVE', quantity: '0.75', expiresAt: '2026-12-01', receivedAt: stamp },
    { id: 'first', productId: 'pos', inventoryBatchId: 'new', status: 'ACTIVE', quantity: '1.25', expiresAt: '2026-11-01', receivedAt: stamp }]
  const lotReserved = await plan(source, { ...input, quantity: '1' })
  assert.equal(lotReserved.result.allocations[0].inventoryBatchId, 'new')
  const consumed = await plan(apply(source, lotReserved), { ...input, quantity: '0', action: 'consume' }, lotReserved.result)
  assert.equal(consumed.lotWrites[0].id, 'first'); assert.equal(consumed.lotWrites[0].data.quantity, '0.25')
  assert.equal(consumed.movementSlices[0].lotId, 'first')
  source.lots[1].expiresAt = '2026-10-13'
  await assert.rejects(plan(source, { ...input, quantity: '1' }), { status: 409 })
})
test('batch/scope drift and unsupported recipe/serial/cost consumers refuse before producing writes', async () => {
  let source = fixture(); source.balances[0].onHand = '5'
  await assert.rejects(plan(source), { status: 409 })
  source = fixture(); source.batches[0].reservedBaseQuantity = '1'
  await assert.rejects(plan(source), { status: 409 })
  for (const change of [{ recipe: {} }, { trackingMode: 'SERIAL' }, { costCorrectionId: 'correction' }]) {
    source = fixture(); Object.assign(source.products[0], change)
    await assert.rejects(plan(source), { status: 501 })
  }
})
