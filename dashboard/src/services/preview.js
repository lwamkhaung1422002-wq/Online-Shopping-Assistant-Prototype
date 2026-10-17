// Read-only prototype preview. Connected stores never fall back to bundled stock/data.
import products from '../config/products.json'
import shop from '../config/shop.json'
import { getProductImages } from '../config/productImages.js'
import { getSizeConfig } from '../config/sizeRules.js'
const fields = [{ key: 'bust', label: 'ရင်', unit: 'in' }, { key: 'waist', label: 'ခါး', unit: 'in' }, { key: 'hip', label: 'တင်', unit: 'in' }, { key: 'weight', label: 'ကိုယ်အလေးချိန်', unit: 'lb' }]
export const previewProducts = products.map((product, index) => {
  const config = getSizeConfig(product.id)
  const guide = config ? { name: 'Size Guide', fields: config.type === 'free-weight-only' ? fields.filter((f) => f.key === 'weight') : fields,
    sizes: config.type === 'numbered' ? Object.entries(config.rules).map(([id, rule]) => ({ id, ...rule })) : [{ id: 'free', label: 'Free Size', ...(config.rules || { weight: config.weightRange }) }], notes: '' } : null
  return { ...product, slug: product.id, status: 'published', created_at: '2026-08-12T00:00:00Z', display_order: index, images: getProductImages(product.id) || product.album, guide, variants: [], memberships: [] }
})
export const previewSettings = { store_name: shop.name, hero_title: 'Collection', hero_description: 'Choose a style and explore the size guide.', phone: shop.phones[0], telegram: shop.telegram, messenger: shop.messenger, tiktok: shop.tiktok, delivery_fee: 0, announcement: '' }
