import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { assertMainReadonlyStartup } from '../../BelleLocal POS app/functions/src/main-readonly/startup.js'
import { createMainSidecarFirestore } from '../../BelleLocal POS app/functions/src/main-local/firestore.js'
import { createLegacyStockOpening } from '../../BelleLocal POS app/functions/src/pos/legacy-stock-opening.js'

async function main() {
  const { credentialPath } = assertMainReadonlyStartup()
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath
  process.env.METADATA_SERVER_DETECTION = 'none'
  const catalogue = JSON.parse(await readFile(new URL('../docs/evidence/main-catalogue-created.json', import.meta.url), 'utf8'))
  if (!catalogue.identitiesMatch || !catalogue.originalSourceUnchanged) throw Error('No opening review prepared. Catalogue evidence requires reconciliation.')
  const require = createRequire(new URL('../../BelleLocal POS app/functions/package.json', import.meta.url))
  const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
  const app = initializeApp({ projectId: 'pos-shop-owner', credential: applicationDefault() }, 'main-stock-opening-review'), raw = getFirestore(app)
  try {
    const db = createMainSidecarFirestore(raw), service = createLegacyStockOpening({ db, ownerUid: 'UXRbRF184gcohMkl4CdS0i0rdow2', allowedShopId: 'belle-online' })
    const preview = await service.preview('belle-online', 'UXRbRF184gcohMkl4CdS0i0rdow2')
    if (preview.snapshotHash !== catalogue.sourceHashAfter || preview.currentOpening || preview.stagingProgress || preview.variants.some(variant => !catalogue.mappings.some(mapping => mapping.legacy_variant_key === variant.key))) throw Error('No opening review prepared. Original stock or existing opening requires review.')
    const report = { observedAt: new Date().toISOString(), availableToOpen: preview.variants.reduce((sum, variant) => sum + variant.available, 0), receiptCount: preview.batches.length,
      variantCount: preview.variants.length, activationEnabled: false, originalWrites: false, writerFreezeRequired: true,
      request: { expected_snapshot_hash: preview.snapshotHash, mappings: catalogue.mappings }, variants: preview.variants, batches: preview.batches }
    await writeFile(new URL('../docs/evidence/main-stock-opening-review.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify({ availableToOpen: report.availableToOpen, variants: report.variantCount, receipts: report.receiptCount, activationEnabled: false, writesPerformed: false, report: 'docs/evidence/main-stock-opening-review.json' }))
  } finally { await raw.terminate(); await deleteApp(app) }
}
main().catch(error => { console.error(error.message?.startsWith('No ') ? error.message : `Read-only opening preview failed (${error.status || error.code || 'source'}). No database writes performed.`); process.exitCode = 2 })
