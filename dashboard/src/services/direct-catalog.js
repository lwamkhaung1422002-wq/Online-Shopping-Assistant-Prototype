import { collection, doc, getDoc, getDocFromServer, getDocs, getDocsFromServer, query, where } from 'firebase/firestore'
import { createDirectTracking } from '../../shared/direct-tracking.js'
import { createFrozenOrderRepository } from '../../shared/frozen-order-repository.js'

export function createDirectCatalog({ db, auth, shopId = 'belle-online', resolveImage = image => image, sdk = { collection, doc, getDoc, getDocFromServer, getDocs, getDocsFromServer, query, where } }) {
  if (shopId !== 'belle-online') throw new Error('Use the configured Belle shop.')
  const root = `onlineShopV2/${shopId}`
  const tracking = createDirectTracking({ db,sdk })
  const orders = auth ? createFrozenOrderRepository({db,auth}) : null
  const rows = async table => (await sdk.getDocs(sdk.collection(db, `${root}/${table}`))).docs.map(row => ({ ...row.data(), id: row.id }))
  async function catalog() {
    const [products, categories, guides, stock,book] = await Promise.all([
      sdk.getDocs(sdk.query(sdk.collection(db, `${root}/public_products`), sdk.where('status', '==', 'published'))),
      rows('public_categories'), rows('public_size_guides'), rows('public_stock'),
      sdk.getDoc(sdk.doc(db,`${root}/public_checkout_book/main`)).then(row=>row.data()),
    ])
    const frame=book?.checkout_enabled ? (await sdk.getDoc(sdk.doc(db,`${root}/public_checkout_frames/${book.frame_id}`))).data() : null
    return products.docs.map(row => {
      const product = row.data()
      const variants = product.variants.map(variant => {
        const balance = stock.find(value => value.id === variant.id)
        if (!balance || !Number.isSafeInteger(balance.available) || balance.available < 0 || !Number.isSafeInteger(balance.price) || balance.price < 0) throw new Error('Shared POS availability is not connected yet. Please contact the shop.')
        const quote=book?.quotes?.[variant.id],scope=frame?.scopes?.[quote?.scope_key]
        const booked=scope ? Math.max(0,scope.capacity-(book.cursors[quote.scope_key] || 0)) : balance.available
        return { id: variant.id, color: variant.color, size: variant.size, price: balance.price, active: true, available:Math.min(balance.available,booked) }
      })
      const category = categories.find(value => value.id === product.category_id), guide = guides.find(value => value.id === product.size_guide_id)
      return { id: row.id, name: product.name, slug: product.slug, description: product.description, status: 'published',
        created_at: product.created_at, display_order: product.display_order, featured: product.featured,
        category_id: product.category_id, category: category ? { id: category.id, name: category.name, description: category.description || '', display_order: category.display_order || 0 } : null,
        guide: guide ? { id: guide.id, name: guide.name, notes: guide.notes || '', fields: guide.fields, sizes: guide.sizes, image_path: guide.image_path || null } : null,
        images: (product.images || []).map(({ id, src, asset_id, alt, color, position, is_cover }) => resolveImage({ id, src, asset_id, alt, color, position, is_cover })),
        memberships: (product.memberships || []).map(({ collection_id }) => ({ collection_id })), variants }
    }).sort((a, b) => a.display_order - b.display_order || a.id.localeCompare(b.id))
  }
  return async (path, body, { method = body === undefined ? 'GET' : 'POST' } = {}) => {
    if (path === 'track-order' && method === 'POST') return tracking(body?.reference,body?.tracking_token)
    if(path==='checkout' && method==='POST'){
      if(!orders)throw new Error('The customer Firebase session is not connected yet.')
      return orders.submit(body)
    }
    if (method !== 'GET' || body !== undefined) throw new Error('Direct Firebase ordering is not connected yet.')
    if (path === 'catalog') return catalog()
    if (path === 'settings') {
      const [storedSnapshot,bookSnapshot,metaSnapshot,contentSnapshot]=await Promise.all(['public_store_settings','public_checkout_book','direct_stock_meta','content_meta'].map(table=>sdk.getDoc(sdk.doc(db,`${root}/${table}/main`))))
      const stored=storedSnapshot.data() || {},book=bookSnapshot.data(),meta=metaSnapshot.data(),content=contentSnapshot.data()
      return { store_name: stored.store_name || 'Belle Local', hero_title: stored.hero_title || 'Collection', hero_description: stored.hero_description || '',
        announcement: stored.announcement || '', phone: stored.phone || '', telegram: stored.telegram || '', messenger: stored.messenger || '', tiktok: stored.tiktok || '',
        // Ordering remains fail-closed until direct stock/order Rules are ready.
        delivery_fee:book?.delivery_fee || 0, checkout_enabled:!!(db.app.options.projectId.startsWith('demo-') && book?.checkout_enabled && book.source_revision===(meta?.version || 0) && book.content_revision===(content?.version || 0)), verification_required:false }
    }
    if (['taxonomy/categories', 'taxonomy/collections'].includes(path)) return (await rows(`public_${path.split('/')[1]}`)).map(({ id, name, display_order }) => ({ id, name, display_order }))
    throw new Error('This workflow has not been converted to direct Firebase yet.')
  }
}
