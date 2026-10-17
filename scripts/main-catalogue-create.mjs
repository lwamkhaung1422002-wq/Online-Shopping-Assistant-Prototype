import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { assertMainLocalStartup } from '../../BelleLocal POS app/functions/src/main-local/startup.js'
import { createMainSidecarFirestore } from '../../BelleLocal POS app/functions/src/main-local/firestore.js'
import { createMainCatalogue, catalogueCreationInput } from '../../BelleLocal POS app/functions/src/main-local/catalogue-create.js'
import { readLegacyCataloguePlan } from '../../BelleLocal POS app/functions/src/main-local/catalogue-plan.js'

async function main() {
  if (process.argv.slice(2).join(' ') !== '--run-live --create-reviewed-catalogue') throw Error('No database request made. This launcher requires explicit reviewed-catalogue creation.')
  const startup = assertMainLocalStartup({ args: ['--run-live', '--allow-sidecar-writes'] })
  const approved = JSON.parse(await readFile(new URL('../docs/evidence/main-catalogue-approved-review.json', import.meta.url), 'utf8'))
  if (approved.request.prices.length !== 20 || approved.approvedMissingPrice.price !== 39500) throw Error('No database request made. The approved review does not match the owner decision.')
  process.env.GOOGLE_APPLICATION_CREDENTIALS = startup.credentialPath
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = 'pos-shop-owner'
  process.env.METADATA_SERVER_DETECTION = 'none'
  const require = createRequire(new URL('../../BelleLocal POS app/functions/package.json', import.meta.url))
  const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
  const app = initializeApp({ projectId: 'pos-shop-owner', credential: applicationDefault() }, 'main-reviewed-catalogue'), raw = getFirestore(app)
  try {
    const db = createMainSidecarFirestore(raw, { writesEnabled: true }), before = await readLegacyCataloguePlan(db)
    const input = catalogueCreationInput(before, approved.request)
    if (input.products.length !== 4 || input.products.flatMap(product => product.variants).length !== 20) throw Error('The source choices no longer match the approved four-design catalogue.')
    console.log(JSON.stringify({ action: 'create-reviewed-catalogue', designs: 4, variants: 20, namespace: 'onlineShopV2/belle-online', sourceWrites: false, stockOpening: false, checkout: false }))
    const result = await createMainCatalogue({ db }).create(approved.request, 'UXRbRF184gcohMkl4CdS0i0rdow2')
    const after = await readLegacyCataloguePlan(db)
    const products = await Promise.all([...new Set(result.mappings.map(mapping => mapping.pos_product_id))].map(key => db.doc(`onlineShopV2/belle-online/pos_products/${key}`).get()))
    const identitiesMatch = result.mappings.every(mapping => products.some(doc => doc.id === mapping.pos_product_id && doc.data().variants.some(variant => variant.id === mapping.pos_variant_id)))
    const report = { observedAt: new Date().toISOString(), ...result, sourceHashBefore: before.snapshotHash, sourceHashAfter: after.snapshotHash,
      originalSourceUnchanged: before.snapshotHash === after.snapshotHash, identitiesMatch,
      storedProducts: products.map(doc => ({ id: doc.id, name: doc.data().name, choices: doc.data().variants.length })),
      stockOpening: false, checkout: false, publicPublished: false, authorization: 'Owner explicitly approved new catalogue records on 2026-10-13.' }
    await writeFile(new URL('../docs/evidence/main-catalogue-created.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
    if (!identitiesMatch || !report.originalSourceUnchanged) throw Error('Catalogue saved; its identity/source reconciliation requires review. Do not activate stock.')
    console.log(JSON.stringify({ designs: products.length, variants: result.variantCount, identitiesMatch, originalSourceUnchanged: report.originalSourceUnchanged, replayed: result.replayed, report: 'docs/evidence/main-catalogue-created.json' }))
  } finally { await raw.terminate(); await deleteApp(app) }
}
main().catch(error => { console.error(error.message?.startsWith('No database request made.') ? error.message : `Catalogue creation stopped: ${error.status ? error.message : 'Review the saved catalogue job before retrying the same approved request.'}`); process.exitCode = 2 })
