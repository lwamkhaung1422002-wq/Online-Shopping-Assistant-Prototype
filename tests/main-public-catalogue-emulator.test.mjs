import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { createMainSidecarFirestore } from '../../BelleLocal POS app/functions/src/main-local/firestore.js'
import { createMainPublicCatalogue } from '../../BelleLocal POS app/functions/src/main-local/public-catalogue.js'
import { createShopStock } from '../../BelleLocal POS app/functions/src/online-shop/stock.js'
import { publicProduct } from '../../BelleLocal POS app/functions/src/online-shop/domain.js'
import { digest } from '../../BelleLocal POS app/functions/src/pos/mutation.js'
import { stockScopeKey } from '../../BelleLocal POS app/functions/src/pos/stock-ledger.js'
import { MAIN_OWNER_UID as owner, MAIN_SHOP_ID as shop } from '../../BelleLocal POS app/functions/src/main-readonly/constants.js'

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw Error('Public catalogue tests require the isolated local Firestore emulator.')
const require = createRequire(new URL('../../BelleLocal POS app/functions/package.json', import.meta.url))
const { initializeApp, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')

test('four public drafts resume interrupted bindings with stable IDs, publish atomically, protect owner edits and private/source/stock records', { timeout: 60_000 }, async () => {
  const projectId = 'demo-main-public-' + randomUUID().slice(0, 8)
  const app = initializeApp({ projectId }, projectId), raw = getFirestore(app)
  assert.ok(raw.projectId.startsWith('demo-'))
  const ref = (table, key) => raw.doc(`onlineShopV2/${shop}/${table}/${key}`)
  const rows = async table => (await raw.collection(`onlineShopV2/${shop}/${table}`).get()).docs.map(doc => [doc.id, doc.data()]).sort(([a], [b]) => a.localeCompare(b))
  const originals = async () => Object.fromEntries(await Promise.all(['stocks', 'orders', 'payments', 'expenses', 'audit', 'catalog', 'meta', 'stockAdjustments', 'paymentReferences'].map(async table => [table, (await raw.collection(`users/${owner}/${table}`).get()).docs.map(doc => [doc.id, doc.data()])])) )
  const inventoryTables = ['pos_products', 'stock_balances', 'stock_batches', 'stock_movements', 'stock_reservations', 'pos_inventory_batches', 'legacy_stock_baselines', 'store_settings']
  const inventory = async () => Object.fromEntries(await Promise.all(inventoryTables.map(async table => [table, await rows(table)])))
  try {
    await raw.doc(`users/${owner}/orders/original`).set({ customer: { name: 'Private original customer', phone: 'Private phone' }, amount: 12345, date: '2026-01-01' })
    await raw.doc(`users/${owner}/stocks/original`).set({ price: 9876, quantity: 7, type: 'Original fixture' })
    const mappings = [], products = []
    for (let productIndex = 0; productIndex < 4; productIndex++) {
      const key = `fixture-dress-${productIndex}`, posId = `pos-product-${productIndex}`, variants = [], posVariants = []
      for (let choiceIndex = 0; choiceIndex < 5; choiceIndex++) {
        const choiceKey = `fixture-choice-${productIndex}-${choiceIndex}`, variantId = `pos-choice-${productIndex}-${choiceIndex}`
        const optionPath = [{ level: 0, label: 'Size', valueId: `size-${choiceIndex}`, value: `Size ${choiceIndex + 1}` }, { level: 1, label: 'Color', valueId: 'brown', value: 'Brown' }]
        const choice = { key: choiceKey, legacy_variant_key: `Size ${choiceIndex + 1}__Brown__Fixture ${productIndex}`, name: `Size ${choiceIndex + 1} / Brown`, optionPath, price: 39500, cost: 19000 }
        variants.push(choice); posVariants.push({ id: variantId, name: choice.name, sku: choiceKey, optionPath, price: choice.price, cost: choice.cost, isActive: true })
        mappings.push({ legacy_variant_key: choice.legacy_variant_key, pos_product_id: posId, pos_variant_id: variantId })
        await ref('stock_balances', stockScopeKey(posId, variantId)).set({ productId: posId, variantId, locationId: 'main', onHand: '5', reserved: '0' })
      }
      products.push({ key, name: `Fixture ${productIndex}`, price: 39500, cost: 19000, variants })
      await ref('pos_products', posId).set({ id: posId, sku: key, name: `Fixture ${productIndex}`, price: 39500, cost: 19000, privateMemo: 'Private product margin', isActive: true, variants: posVariants })
    }
    const input = { sourceHash: 'fixture-original-source', products }
    await ref('legacy_catalogue_jobs', 'main').set({ ownerUid: owner, status: 'READY', sourceHash: input.sourceHash, inputHash: digest(input), input, mappings })
    await ref('legacy_stock_baselines', 'main').set({ owner_uid: owner, source_snapshot_hash: input.sourceHash, status: 'ACTIVE', mappings, result: { availableGranted: 100 } })
    await ref('store_settings', 'main').set({ checkout_enabled: false })
    const beforeOriginals = await originals(), beforeInventory = await inventory()
    const adapter = { projectId: 'pos-shop-owner', doc: path => raw.doc(path), collection: path => raw.collection(path), getAll: (...args) => raw.getAll(...args), runTransaction: (...args) => raw.runTransaction(...args) }
    const db = createMainSidecarFirestore(adapter, { writesEnabled: true }), stock = createShopStock({ db })
    let bindingCalls = 0
    const service = createMainPublicCatalogue({ db, stock: { ...stock, async bind(...args) {
      const result = await stock.bind(...args)
      if (++bindingCalls === 2) throw Error('Fixture lost response after binding commit')
      return result
    } } })
    await assert.rejects(service.review('other-owner'), { status: 403 })
    const review = await service.review(owner), body = { expectedReviewHash: review.reviewHash, publish: true }
    assert.equal(review.productCount, 4); assert.equal(review.variantCount, 20)
    assert.equal(review.draftPreparationOnly, true); assert.equal(review.availabilityIncluded, false)
    assert.equal(review.writesPerformed, false); assert.equal((await rows('products')).length, 0)
    await assert.rejects(service.create(body, 'other-owner'), { status: 403 })
    await assert.rejects(service.create({ ...body, expectedReviewHash: 'stale' }, owner), { status: 409 })
    await assert.rejects(service.create(body, owner), /Fixture lost response/)
    const drafts = await rows('products')
    assert.equal(drafts.length, 4); assert.ok(drafts.every(([, product]) => product.status === 'draft'))
    assert.equal((await rows('stock_bindings')).length, 2)
    assert.deepEqual(drafts.map(([key]) => key), review.products.map(product => product.id).sort())

    const posRef = ref('pos_products', mappings[0].pos_product_id), posBefore = (await posRef.get()).data()
    await posRef.update({ variants: posBefore.variants.map((variant, index) => index === 0 ? { ...variant, price: variant.price + 1 } : variant) })
    await assert.rejects(service.create(body, owner), { status: 409 })
    await posRef.set(posBefore)
    const firstBindingRef = ref('stock_bindings', review.products[0].bindings[0].public_variant_id), bindingBefore = (await firstBindingRef.get()).data()
    await firstBindingRef.update({ scope_key: 'conflicting-stock-scope' })
    await assert.rejects(service.create(body, owner), { status: 409 })
    assert.ok((await rows('products')).every(([, product]) => product.status === 'draft'))
    await firstBindingRef.set(bindingBefore)

    const result = await service.create(body, owner)
    assert.equal(result.publicPublished, true); assert.equal(result.inventoryChanged, false); assert.equal(result.checkoutChanged, false)
    assert.deepEqual(result.productIds, review.products.map(product => product.id))
    const published = await rows('products'), bindings = await rows('stock_bindings')
    assert.equal(published.length, 4); assert.equal(bindings.length, 20)
    assert.ok(published.every(([, product]) => product.status === 'published' && product.images.length === 0 && product.variants.every(choice => choice.on_hand === 0 && choice.reserved === 0)))
    for (const mapping of result.mappings) {
      const binding = bindings.find(([key]) => key === mapping.public_variant_id)[1]
      assert.equal(binding.public_product_id, mapping.public_product_id); assert.equal(binding.pos_product_id, mapping.pos_product_id)
      assert.equal(binding.pos_variant_id, mapping.pos_variant_id); assert.equal(binding.scope_key, stockScopeKey(mapping.pos_product_id, mapping.pos_variant_id))
      assert.equal(binding.actor_uid, owner)
    }
    const publicRows = published.map(([, product]) => publicProduct(product, [], [])), publicJson = JSON.stringify(publicRows)
    for (const privateValue of ['cost', 'privateMemo', 'Private original customer', 'Private phone', 'Private product margin', 'pos_product_id', 'scope_key']) assert.ok(!publicJson.includes(privateValue))
    const afterPreparation = await rows('legacy_public_catalogue_jobs')
    const replay = await service.create(body, owner)
    assert.equal(replay.replayed, true); assert.deepEqual(replay.mappings, result.mappings)
    assert.deepEqual(await rows('products'), published); assert.deepEqual(await rows('stock_bindings'), bindings)
    assert.deepEqual(await rows('legacy_public_catalogue_jobs'), afterPreparation)
    const editedRef = ref('products', result.productIds[0]), edited = (await editedRef.get()).data()
    await editedRef.update({ images: [{ id: 'owner-photo', src: 'owner-photo.jpg', alt: 'Owner supplied photo' }] })
    await assert.rejects(service.create(body, owner), { status: 409 })
    assert.equal((await editedRef.get()).data().images[0].id, 'owner-photo')
    await editedRef.set(edited)
    await editedRef.delete()
    await assert.rejects(service.create(body, owner), { status: 409 })
    assert.equal((await editedRef.get()).exists, false)
    await editedRef.set(edited)
    await firstBindingRef.delete()
    await assert.rejects(service.create(body, owner), { status: 409 })
    assert.equal((await firstBindingRef.get()).exists, false)
    await firstBindingRef.set(bindingBefore)
    assert.deepEqual(await originals(), beforeOriginals); assert.deepEqual(await inventory(), beforeInventory)
  } finally { await raw.terminate(); await deleteApp(app) }
})
