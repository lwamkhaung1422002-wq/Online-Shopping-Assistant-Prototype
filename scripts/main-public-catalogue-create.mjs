import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { assertMainLocalStartup } from '../../BelleLocal POS app/functions/src/main-local/startup.js'
import { createMainSidecarFirestore } from '../../BelleLocal POS app/functions/src/main-local/firestore.js'
import { createMainPublicCatalogue } from '../../BelleLocal POS app/functions/src/main-local/public-catalogue.js'
import { readLegacyCataloguePlan } from '../../BelleLocal POS app/functions/src/main-local/catalogue-plan.js'
import { createShopStock } from '../../BelleLocal POS app/functions/src/online-shop/stock.js'
import { publicProduct } from '../../BelleLocal POS app/functions/src/online-shop/domain.js'
import { digest } from '../../BelleLocal POS app/functions/src/pos/mutation.js'

async function main() {
  if (process.argv.slice(2).join(' ') !== '--run-live --publish-reviewed-catalogue') throw Error('No database request made. Explicit reviewed-public-catalogue publication is required.')
  const { credentialPath } = assertMainLocalStartup({ args: ['--run-live', '--allow-sidecar-writes'] })
  const approved = JSON.parse(await readFile(new URL('../docs/evidence/main-public-catalogue-plan.json', import.meta.url), 'utf8'))
  const opening = JSON.parse(await readFile(new URL('../docs/evidence/main-stock-opening-created.json', import.meta.url), 'utf8'))
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = 'pos-shop-owner'; process.env.METADATA_SERVER_DETECTION = 'none'
  const require = createRequire(new URL('../../BelleLocal POS app/functions/package.json', import.meta.url))
  const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
  const app = initializeApp({ projectId: 'pos-shop-owner', credential: applicationDefault() }, 'main-approved-public-catalogue'), raw = getFirestore(app)
  try {
    const db = createMainSidecarFirestore(raw, { writesEnabled: true }), owner = 'UXRbRF184gcohMkl4CdS0i0rdow2', shop = 'belle-online'
    const before = await readLegacyCataloguePlan(db), service = createMainPublicCatalogue({ db }), review = await service.review(owner)
    const inventory = async () => (await db.collection(`onlineShopV2/${shop}/stock_balances`).get()).docs.map(doc => ({ id: doc.id, ...doc.data() }))
    const inventoryBefore = await inventory()
    if (before.snapshotHash !== opening.sourceHashAfter || review.productCount !== 4 || review.variantCount !== 20 ||
      digest(review.products.map(product => ({ draftKey: product.id, body: { ...product.body, variants: product.body.variants.map(({ id: _id, ...variant }) => variant) } }))) !==
      digest(approved.products.map(product => ({ draftKey: product.draftKey, body: product.body })))) throw Error('The prepared public products no longer match the approved source/prices.')
    console.log(JSON.stringify({ action: 'publish-reviewed-catalogue', products: 4, variants: 20, additionalStock: 0, checkout: false }))
    const result = await service.create({ expectedReviewHash: review.reviewHash, publish: true }, owner)
    const products = await Promise.all(result.productIds.map(async key => (await db.doc(`onlineShopV2/${shop}/products/${key}`).get()).data()))
    const projected = await createShopStock({ db }).project(shop, products)
    const publicProducts = projected.map(product => publicProduct(product, [], []))
    const after = await readLegacyCataloguePlan(db), inventoryAfter = await inventory()
    const available = publicProducts.flatMap(product => product.variants).reduce((sum, variant) => sum + variant.available, 0)
    const report = { observedAt: new Date().toISOString(), result, publicProducts, available,
      sourceHashBefore: before.snapshotHash, sourceHashAfter: after.snapshotHash, originalSourceUnchanged: before.snapshotHash === after.snapshotHash,
      inventoryUnchanged: digest(inventoryBefore) === digest(inventoryAfter), checkout: false,
      authorization: 'Owner explicitly approved showing the four public posts without photos, on 2026-10-13.' }
    await writeFile(new URL('../docs/evidence/main-public-catalogue-created.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
    if (!report.originalSourceUnchanged || !report.inventoryUnchanged || available !== 124 || products.some(product => product.status !== 'published')) throw Error('Public catalogue saved; source/inventory reconciliation requires review. Keep checkout disabled.')
    console.log(JSON.stringify({ products: products.length, variants: result.variantCount, available, originalSourceUnchanged: true, inventoryUnchanged: true, checkout: false, report: 'docs/evidence/main-public-catalogue-created.json' }))
  } finally { await raw.terminate(); await deleteApp(app) }
}
main().catch(error => { console.error(error.message?.startsWith('No ') ? error.message : `Public catalogue stopped: ${error.status ? error.message : 'Review the saved publication state before retrying the same review.'}`); process.exitCode = 2 })
