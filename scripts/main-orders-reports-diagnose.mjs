import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { assertMainLocalStartup } from '../../BelleLocal POS app/functions/src/main-local/startup.js'
import { createMainSidecarFirestore } from '../../BelleLocal POS app/functions/src/main-local/firestore.js'
import { createPosOrderList } from '../../BelleLocal POS app/functions/src/pos/order-list.js'
import { createPosSalesReport } from '../../BelleLocal POS app/functions/src/pos/sales-report.js'
import { createPosPaymentReport } from '../../BelleLocal POS app/functions/src/pos/payment-report.js'
import { createPosProductReport } from '../../BelleLocal POS app/functions/src/pos/product-report.js'
import { createPosOperationsReport } from '../../BelleLocal POS app/functions/src/pos/operations-report.js'
import { legacySourceHash } from '../../BelleLocal POS app/functions/src/pos/history.js'
import { digest } from '../../BelleLocal POS app/functions/src/pos/mutation.js'

async function main() {
  if (process.argv.slice(2).join(' ') !== '--run-live') throw Error('Use the explicit Main read-only diagnostic.')
  const { credentialPath } = assertMainLocalStartup()
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = 'pos-shop-owner'; process.env.METADATA_SERVER_DETECTION = 'none'
  const require = createRequire(new URL('../../BelleLocal POS app/functions/package.json', import.meta.url))
  const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
  const app = initializeApp({ projectId: 'pos-shop-owner', credential: applicationDefault() }, 'main-orders-reports-diagnose'), raw = getFirestore(app)
  try {
    const owner = 'UXRbRF184gcohMkl4CdS0i0rdow2', shop = 'belle-online', db = createMainSidecarFirestore(raw)
    const sourceNames = ['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta']
    const sidecarCollections = await raw.doc(`onlineShopV2/${shop}`).listCollections()
    const audit = await raw.runTransaction(async tx => {
      const source = await Promise.all(sourceNames.map(name => tx.get(raw.collection(`users/${owner}/${name}`))))
      const sidecar = await Promise.all(sidecarCollections.map(ref => tx.get(ref)))
      const sourceEvidence = source.flatMap(s => s.docs.map(doc => ({ path: doc.ref.path, sha256: legacySourceHash(doc) })))
      const hashRows = names => digest(sourceEvidence.filter(row => names.some(name => row.path.startsWith(`users/${owner}/${name}/`))).sort((a,b) => a.path.localeCompare(b.path)))
      const metadata = snapshot => ({ count: snapshot.size, latestUpdate: snapshot.docs.reduce((latest, doc) => { const value = doc.updateTime?.toDate().toISOString() || ''; return value > latest ? value : latest }, '') })
      return { sourceCollections: Object.fromEntries(sourceNames.map((name,i) => [name, { ...metadata(source[i]), hash: hashRows([name]) }])),
        sidecarCollections: Object.fromEntries(sidecarCollections.map((ref,i) => [ref.id, metadata(sidecar[i])])),
        originalStockAndOrdersHash: hashRows(['orders','stocks']),
        knownOrderHash: sourceEvidence.find(row => row.path.endsWith('/orders/QqCHl8BRInz67ZomN9jY'))?.sha256 }
    }, { readOnly: true })
    const opening = JSON.parse(await readFile(new URL('../docs/evidence/main-stock-opening-created.json', import.meta.url),'utf8'))
    const diagnostics = []
    const cases = [
      ['order-search', () => createPosOrderList({db,ownerUid:owner}).list(shop,{search:'QqCHl8BRIn',view:'summary',paged:'true'})],
      ['sales', () => createPosSalesReport({db,ownerUid:owner}).get(shop,{from:'2026-01-01',to:'2026-12-31'})],
      ['payments', () => createPosPaymentReport({db,ownerUid:owner}).get(shop,{from:'2026-01-01',to:'2026-12-31'})],
      ['products', () => createPosProductReport({db}).get(shop,{})],
      ['operations', () => createPosOperationsReport({db,ownerUid:owner}).get(shop,{})],
    ]
    for (const [name, get] of cases) {
      try { const value = await get(); diagnostics.push({ name, ok: true, resultKeys: Object.keys(value), orderMatches: value.orders?.length, saleRecords: value.saleRecords?.length }) }
      catch (error) { diagnostics.push({ name, ok: false, code: error.code ?? null, status: error.status ?? null, message: String(error.message).slice(0,1200) }) }
    }
    const report = { observedAt: new Date().toISOString(), ...audit,
      originalStockAndOrdersMatchApprovedOpening: audit.originalStockAndOrdersHash === opening.sourceHashAfter,
      knownOrderMatchesEarlierObservation: audit.knownOrderHash === '4dba39318712d1f655c99be55b10613bb0041463675291f5d90c03f6fded721c',
      historicalComparisonLimit: 'Earlier hashes exist for original orders/stocks and the supplied order. Other collections have a current hash/count only; this is not a complete historical mutation log.',
      databaseWritesPerformed: false, diagnostics }
    await writeFile(new URL('../docs/evidence/main-orders-reports-diagnostic.json', import.meta.url),JSON.stringify(report,null,2)+'\n')
    console.log(JSON.stringify(report))
  } finally { await raw.terminate(); await deleteApp(app) }
}
main().catch(async error => {
  await writeFile(new URL('../docs/evidence/main-orders-reports-diagnostic-failure.json',import.meta.url),JSON.stringify({
    observedAt:new Date().toISOString(),liveDatabaseAuditComplete:false,databaseWritesPerformed:false,
    code:error.code || error.status || error.name,message:String(error.message).slice(0,1200),
  },null,2)+'\n')
  console.error(`Read-only diagnostic failed (${error.code || error.status || error.name}): ${error.message}`); process.exitCode = 2
})
