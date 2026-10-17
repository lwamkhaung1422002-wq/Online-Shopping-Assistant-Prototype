import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { assertMainLocalStartup } from '../../BelleLocal POS app/functions/src/main-local/startup.js'
import { createMainSidecarFirestore } from '../../BelleLocal POS app/functions/src/main-local/firestore.js'
import { createLegacyStockOpening } from '../../BelleLocal POS app/functions/src/pos/legacy-stock-opening.js'
import { digest } from '../../BelleLocal POS app/functions/src/pos/mutation.js'

async function main() {
  if (process.argv.slice(2).join(' ') !== '--run-live --open-reviewed-stock --legacy-writers-stopped') throw Error('No database request made. Explicit reviewed opening and stopped-writer confirmation are required.')
  const startup = assertMainLocalStartup({ args: ['--run-live', '--allow-sidecar-writes', '--legacy-writers-stopped'] })
  const review = JSON.parse(await readFile(new URL('../docs/evidence/main-stock-opening-review.json', import.meta.url), 'utf8'))
  if (review.availableToOpen !== 124 || review.receiptCount !== 18 || review.request.mappings.length !== 20) throw Error('No database request made. The reviewed opening quantities no longer match the owner approval.')
  process.env.GOOGLE_APPLICATION_CREDENTIALS = startup.credentialPath
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = 'pos-shop-owner'
  process.env.METADATA_SERVER_DETECTION = 'none'
  const require = createRequire(new URL('../../BelleLocal POS app/functions/package.json', import.meta.url))
  const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
  const app = initializeApp({ projectId: 'pos-shop-owner', credential: applicationDefault() }, 'main-reviewed-stock-opening'), raw = getFirestore(app)
  try {
    const db = createMainSidecarFirestore(raw, { writesEnabled: true }), owner = 'UXRbRF184gcohMkl4CdS0i0rdow2', shop = 'belle-online'
    const service = createLegacyStockOpening({ db, ownerUid: owner, allowedShopId: shop, enabled: true })
    const before = await service.preview(shop, owner)
    if (before.snapshotHash !== review.request.expected_snapshot_hash) throw Error('Original stock changed since review. Do not activate this opening.')
    console.log(JSON.stringify({ action: 'open-reviewed-stock', available: 124, receipts: 18, variants: 20, sourceWrites: false, checkout: false, writerFreeze: 'Owner confirmed stopped original POS writes.' }))
    const requestKey = digest(['main-approved-stock-opening', owner, shop, review.request])
    let result = await service.activate(shop, review.request, owner, requestKey)
    while (result.status === 'STAGING') result = await service.activate(shop, review.request, owner, requestKey)
    const after = await service.preview(shop, owner)
    const balances = (await db.collection(`onlineShopV2/${shop}/stock_balances`).get()).docs.map(doc => ({ id: doc.id, ...doc.data() }))
    const available = balances.reduce((sum, balance) => sum + Number(balance.onHand) - Number(balance.reserved), 0)
    const report = { observedAt: new Date().toISOString(), result, requestKey, sourceHashBefore: before.snapshotHash, sourceHashAfter: after.snapshotHash,
      originalSourceUnchanged: before.snapshotHash === after.snapshotHash, openingActive: !!after.currentOpening, available, balances,
      checkout: false, publicPublished: false, writerFreeze: 'Owner personally confirmed original POS writes stopped on 2026-10-13; no rules were changed.' }
    await writeFile(new URL('../docs/evidence/main-stock-opening-created.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
    if (!report.originalSourceUnchanged || !report.openingActive || available !== 124 || result.availableGranted !== 124) throw Error('Opening recorded; its stock/source reconciliation requires review. Keep checkout disabled.')
    console.log(JSON.stringify({ available, openingActive: true, originalSourceUnchanged: true, checkout: false, report: 'docs/evidence/main-stock-opening-created.json' }))
  } finally { await raw.terminate(); await deleteApp(app) }
}
main().catch(error => { console.error(error.message?.startsWith('No ') ? error.message : `Stock opening stopped: ${error.status ? error.message : 'Review the saved opening report/state before retrying the same request.'}`); process.exitCode = 2 })
