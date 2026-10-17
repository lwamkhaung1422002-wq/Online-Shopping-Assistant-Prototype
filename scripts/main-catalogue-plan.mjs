import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { assertMainReadonlyStartup } from '../../BelleLocal POS app/functions/src/main-readonly/startup.js'
import { createMainSidecarFirestore } from '../../BelleLocal POS app/functions/src/main-local/firestore.js'
import { readLegacyCataloguePlan } from '../../BelleLocal POS app/functions/src/main-local/catalogue-plan.js'

async function main() {
  const { credentialPath } = assertMainReadonlyStartup()
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath
  process.env.METADATA_SERVER_DETECTION = 'none'
  const require = createRequire(new URL('../../BelleLocal POS app/functions/package.json', import.meta.url))
  const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
  const app = initializeApp({ projectId: 'pos-shop-owner', credential: applicationDefault() }, 'main-catalogue-read-plan'), rawDb = getFirestore(app)
  try {
    const plan = await readLegacyCataloguePlan(createMainSidecarFirestore(rawDb))
    await writeFile(new URL('../docs/evidence/main-catalogue-plan.json', import.meta.url), JSON.stringify({ observedAt: new Date().toISOString(), ...plan }, null, 2) + '\n')
    console.log(JSON.stringify({ designs: plan.productCount, variants: plan.variantCount, batches: plan.stockBatchCount, pricesNeedingInput: plan.products.flatMap(product => product.variants).filter(variant => variant.proposedPrice == null).length, writesPerformed: false, report: 'docs/evidence/main-catalogue-plan.json' }))
  } finally { await rawDb.terminate(); await deleteApp(app) }
}
main().catch(error => { console.error(error.message?.startsWith('No database request made.') ? error.message : `Original catalogue planning failed (${error.code || error.status || 'source'}). No source or sidecar writes were performed.`); process.exitCode = 2 })
