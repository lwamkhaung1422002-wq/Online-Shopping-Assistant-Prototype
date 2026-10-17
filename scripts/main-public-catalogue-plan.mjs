import { readFile, writeFile } from 'node:fs/promises'
import { normalizeProduct, publicProduct } from '../../BelleLocal POS app/functions/src/online-shop/domain.js'

const read = async name => JSON.parse(await readFile(new URL(`../docs/${name}`, import.meta.url), 'utf8'))
const [plan, prices, catalogue, stock] = await Promise.all(['main-catalogue-plan.json', 'main-catalogue-approved-review.json', 'main-catalogue-created.json', 'main-stock-opening-created.json'].map(read))
if (!stock.openingActive || !stock.originalSourceUnchanged || !catalogue.identitiesMatch) throw Error('Public plan requires a verified catalogue and stock opening.')
const approved = new Map(prices.request.prices.map(row => [row.key, row.price]))
const products = plan.products.map((product, index) => {
  const body = { name: product.name, slug: product.key, description: '', status: 'draft', featured: false, display_order: index,
    variants: product.variants.map(variant => { const [size, color] = variant.legacy_variant_key.split('__'); return { sku: variant.key, size, color, price: approved.get(variant.key), active: true } }) }
  const normalized = normalizeProduct(body, null, 'belle-online')
  return { draftKey: product.key, body, bindings: product.variants.map(variant => {
    const mapping = catalogue.mappings.find(row => row.legacy_variant_key === variant.legacy_variant_key)
    if (!mapping) throw Error('The public choice has no saved POS mapping.')
    return { sku: variant.key, ...mapping }
  }), proposedPublicProjection: publicProduct(normalized, [], []) }
})
if (products.length !== 4 || products.reduce((sum, product) => sum + product.body.variants.length, 0) !== 20) throw Error('The public catalogue choices do not match the approved designs.')
const report = { preparedAt: new Date().toISOString(), productCount: 4, variantCount: 20, sharedAvailable: stock.available,
  proposedPublication: 'published after every choice is bound to its existing POS stock scope', images: 'No product photos were supplied; Admin can add actual photos later.',
  checkout: false, writesPerformed: false, products }
await writeFile(new URL('../docs/evidence/main-public-catalogue-plan.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ products: 4, variants: 20, sharedAvailable: stock.available, writesPerformed: false, checkout: false, report: 'docs/evidence/main-public-catalogue-plan.json' }))
