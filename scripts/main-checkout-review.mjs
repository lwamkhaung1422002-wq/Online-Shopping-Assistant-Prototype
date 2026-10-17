import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { assertMainLocalStartup } from '../../BelleLocal POS app/functions/src/main-local/startup.js'
import { createMainSidecarFirestore } from '../../BelleLocal POS app/functions/src/main-local/firestore.js'
import { createShopStock } from '../../BelleLocal POS app/functions/src/online-shop/stock.js'
import { stockScopeKey } from '../../BelleLocal POS app/functions/src/pos/stock-ledger.js'

async function main() {
  if (process.argv.slice(2).join(' ') !== '--run-live') throw Error('No database request made. Use the explicit read-only review.')
  const { credentialPath } = assertMainLocalStartup()
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = 'pos-shop-owner'
  process.env.METADATA_SERVER_DETECTION = 'none'
  const require = createRequire(new URL('../../BelleLocal POS app/functions/package.json', import.meta.url))
  const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
  const app = initializeApp({ projectId: 'pos-shop-owner', credential: applicationDefault() }, 'main-checkout-read-review'), raw = getFirestore(app)
  try {
    const db = createMainSidecarFirestore(raw), shop = 'belle-online', path = `onlineShopV2/${shop}`
    const [opening, products, bindings] = await Promise.all([
      db.doc(`${path}/legacy_stock_baselines/main`).get(), db.collection(`${path}/products`).get(), db.collection(`${path}/stock_bindings`).get(),
    ])
    if (opening.data()?.status !== 'ACTIVE') throw Error('Shared stock opening is not active.')
    const publicProducts = products.docs.map(doc => ({ ...doc.data(), id: doc.id })).filter(row => row.status === 'published')
    const bound = new Map(bindings.docs.map(doc => [doc.id, doc.data()]))
    for (const product of publicProducts) for (const variant of product.variants) {
      const binding = bound.get(variant.id)
      if (!binding || binding.public_product_id !== product.id || binding.public_variant_id !== variant.id ||
        binding.scope_key !== stockScopeKey(binding.pos_product_id, binding.pos_variant_id)) throw Error('Published stock bindings require reconciliation.')
    }
    if (publicProducts.length !== 4 || publicProducts.flatMap(row => row.variants).length !== 20) throw Error('The approved public catalogue changed. Review its current posts before activation.')
    const projected = await createShopStock({ db }).project(shop, publicProducts)
    const settings = await fetch('http://127.0.0.1:5003/belle-online/settings', { signal: AbortSignal.timeout(30_000) })
    if (!settings.ok) throw Error('The current local API settings are unavailable.')
    const current = await settings.json()
    const report = {
      observedAt: new Date().toISOString(), project: 'pos-shop-owner', shop,
      sharedStock: opening.data().status, products: publicProducts.length, variants: 20,
      available: projected.flatMap(row => row.variants).reduce((sum, row) => sum + row.available, 0),
      everyPublishedVariantBound: true, currentCheckoutEnabled: current.checkout_enabled,
      changesPrepared: ['Restart the same loopback Main API with --allow-checkout; keep scoped owner writes and stopped legacy-writer flags.'],
      proposedCommand: 'node functions/src/main-local/server.mjs --run-live --allow-sidecar-writes --legacy-writers-stopped --local-media --allow-checkout',
      proposedEffect: 'Real customer checkout reserves the same POS stock and saves new online orders/tracking credentials in onlineShopV2/belle-online. No original users records change.',
      agentMainTestOrders: false, databaseWritesPerformed: false, activationPerformed: false,
      writerFreeze: 'Owner confirmed original POS writers stopped on 2026-10-13; no rules change.',
    }
    await writeFile(new URL('../docs/evidence/main-checkout-activation-review.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report))
  } finally { await raw.terminate(); await deleteApp(app) }
}
main().catch(error => { console.error(error.message?.startsWith('No ') ? error.message : 'Checkout read review failed. Keep the current runtime unchanged and reconcile its catalogue/stock.'); process.exitCode = 2 })
