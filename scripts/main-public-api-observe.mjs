import { writeFile } from 'node:fs/promises'

const api = 'http://127.0.0.1:5003/belle-online', headers = { Origin: 'http://127.0.0.1:5179' }
const args = process.argv.slice(2)
if (args.length > 1 || (args.length && args[0] !== '--checkout-enabled')) throw Error('Use the prepared public observation mode.')
const checkoutEnabled = args[0] === '--checkout-enabled'
const read = async path => { const response = await fetch(`${api}/${path}`, { headers, signal: AbortSignal.timeout(30_000) }); if (!response.ok) throw Error(`Public API ${path}: ${response.status}`); return response.json() }
const [products, settings] = await Promise.all([read('catalog'), read('settings')])
const variants = products.flatMap(product => product.variants), available = variants.reduce((sum, variant) => sum + variant.available, 0)
if (products.length !== 4 || variants.length !== 20 || !Number.isSafeInteger(available) || available < 0 || settings.checkout_enabled !== checkoutEnabled ||
  (checkoutEnabled && settings.phone !== '09666655928')) throw Error('Public catalogue/runtime/contact does not match the approved activation.')
const privateFields = new Set(['cost', 'profit', 'pos_product_id', 'pos_variant_id', 'customer', 'payment', 'scope_key'])
function publicOnly(value) { if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { if (privateFields.has(key)) throw Error('A private field entered the public product response.'); publicOnly(item) } }
publicOnly(products)
const report = { observedAt: new Date().toISOString(), endpoint: `${api}/catalog`, products: products.length, variants: variants.length, available,
  checkout: settings.checkout_enabled, names: products.map(product => product.name), privateProductFieldsAbsent: true,
  contacts: Object.fromEntries(['phone', 'telegram', 'messenger', 'tiktok'].map(key => [key, !!settings[key]])), publicPhone: settings.phone,
  databaseWritesPerformed: false, agentMainTestOrders: false, browserRendered: false }
await writeFile(new URL(checkoutEnabled ? '../docs/evidence/main-public-checkout-observation.json' : '../docs/evidence/main-public-api-observation.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
