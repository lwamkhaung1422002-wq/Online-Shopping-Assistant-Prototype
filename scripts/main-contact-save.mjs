import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { assertMainLocalStartup } from '../../BelleLocal POS app/functions/src/main-local/startup.js'
import { createMainSidecarFirestore } from '../../BelleLocal POS app/functions/src/main-local/firestore.js'
import { defaultSettings, normalizeStoreSettings } from '../../BelleLocal POS app/functions/src/online-shop/domain.js'

async function main() {
  if (process.argv.slice(2).join(' ') !== '--run-live --save-approved-contact') throw Error('No database request made. Use the approved public contact action.')
  const { credentialPath } = assertMainLocalStartup({ args: ['--run-live', '--allow-sidecar-writes'] })
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = 'pos-shop-owner'; process.env.METADATA_SERVER_DETECTION = 'none'
  const require = createRequire(new URL('../../BelleLocal POS app/functions/package.json', import.meta.url))
  const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
  const app = initializeApp({ projectId: 'pos-shop-owner', credential: applicationDefault() }, 'main-approved-public-contact'), raw = getFirestore(app)
  try {
    const db = createMainSidecarFirestore(raw, { writesEnabled: true }), path = 'onlineShopV2/belle-online/store_settings/main', ref = db.doc(path)
    const result = await db.runTransaction(async tx => {
      const saved = await tx.get(ref), current = saved.data() || {}
      const values = normalizeStoreSettings({ ...defaultSettings, ...current, phone: '09666655928' })
      if (current.phone === values.phone) return { replayed: true }
      // This approval changes only the public phone; retain every other saved field.
      if (saved.exists) tx.update(ref, { phone: values.phone })
      else tx.create(ref, { ...values, id: 'main', shop_id: 'belle-online', created_at: new Date().toISOString() })
      return { replayed: false }
    })
    const saved = (await ref.get()).data()
    if (saved.phone !== '09666655928') throw Error('Approved contact was not persisted.')
    const report = { observedAt: new Date().toISOString(), path, phone: saved.phone, ...result,
      originalWrites: false, authorization: 'Owner explicitly supplied this public CS phone on 2026-10-13; no other contact requested.' }
    await writeFile(new URL('../docs/evidence/main-public-contact-saved.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report))
  } finally { await raw.terminate(); await deleteApp(app) }
}
main().catch(error => { console.error(error.message?.startsWith('No ') ? error.message : 'Approved contact save failed. Review its saved value before retrying the same phone.'); process.exitCode = 2 })
