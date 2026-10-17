import test from 'node:test'
import assert from 'node:assert/strict'
import { decimalQuantity, storedQuantity, quantityDecimal, compatibilityQuantity, conversionFactor, convertedBaseQuantity, batchGrossData, batchReservationData, batchAvailableBase } from '../../BelleLocal POS app/functions/src/pos/quantity.js'
import { runPosTransaction } from '../../BelleLocal POS app/functions/src/pos/transaction.js'

test('Retails quantity contract preserves decimal limits, unit conversion and compatibility rounding', () => {
  assert.equal(decimalQuantity('0.001', { positive: true }).toString(), '0.001')
  assert.equal(decimalQuantity('2147483647').toString(), '2147483647')
  for (const quantity of ['-1', 'NaN', 'Infinity', '0.0001', '2147483647.001', 'invalid']) assert.throws(() => decimalQuantity(quantity), { status: 400 })
  assert.throws(() => decimalQuantity(0, { positive: true }), { status: 400 })
  assert.equal(storedQuantity('4000000000').toString(), '4000000000')
  assert.equal(storedQuantity('999999999999999.999').toFixed(3), '999999999999999.999')
  assert.throws(() => storedQuantity('1000000000000000'), { status: 400 })
  assert.equal(conversionFactor('0.000001').toString(), '0.000001')
  assert.throws(() => conversionFactor('0.0000001'), { status: 400 })
  assert.equal(convertedBaseQuantity('1.25', '12').toString(), '15')
  assert.throws(() => convertedBaseQuantity('0.001', '0.5'), { status: 400 })
  assert.equal(quantityDecimal('1.2345').toString(), '1.235')
  assert.equal(compatibilityQuantity('1.5'), 2)
  assert.deepEqual(batchGrossData('1.125'), { baseQuantity: '1.125', quantity: 1 })
  assert.deepEqual(batchReservationData('0.625'), { reservedBaseQuantity: '0.625', reservedQuantity: 1 })
  assert.deepEqual(batchGrossData('2147483647.499'), {baseQuantity:'2147483647.499',quantity:2147483647})
  assert.throws(()=>batchGrossData('2147483647.5'),{status:400})
  assert.equal(batchAvailableBase({ quantity: 2, reservedQuantity: 1 }).toString(), '1')
  assert.equal(batchAvailableBase({ baseQuantity: '0.3', reservedBaseQuantity: '0.1' }).minus('0.2').toString(), '0')
  const exactCost = 2147483646999n * 2147483647n
  assert.equal(decimalQuantity('2147483646.999').mul(2147483647).toFixed(3), `${exactCost / 1000n}.${String(exactCost % 1000n).padStart(3, '0')}`)
})

test('POS retry restarts only a known closed read before writes, never invalid payloads or uncertain commits', async () => {
  const closed = () => Object.assign(new Error('3 INVALID_ARGUMENT: Transaction is invalid or closed.'), { code: 3, details: 'Transaction is invalid or closed.' })
  let attempts = 0; const writes = []
  const db = { async runTransaction(action) {
    attempts++
    return action({ async get() { if (attempts === 1) throw closed(); return { exists: false } }, create(...args) { writes.push(args) } })
  } }
  assert.equal(await runPosTransaction(db, async (tx) => { await tx.get('product'); tx.create('product', { quantity: 2 }); return 'created' }), 'created')
  assert.equal(attempts, 2); assert.deepEqual(writes, [['product', { quantity: 2 }]])
  for (const mode of ['other-invalid-argument', 'commit', 'read-after-write', 'exhausted']) {
    attempts = 0
    const error = mode === 'other-invalid-argument' ? Object.assign(new Error('Invalid field'), { code: 3 }) : closed()
    const failing = { async runTransaction(action) {
      attempts++
      await action({ async get() { if (mode !== 'commit') throw error; return {} }, set() {} })
      throw error // simulate a failure from commit, with no marked read error
    } }
    await assert.rejects(runPosTransaction(failing, async (tx) => { if (mode === 'read-after-write') tx.set('product', {}); await tx.get('product') }), (caught) => caught === error)
    assert.equal(attempts, mode === 'exhausted' ? 5 : 1, mode)
  }
})
