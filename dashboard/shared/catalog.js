export const ORDER_LABELS = {
  pending: 'Awaiting confirmation', confirmed: 'Confirmed', packing: 'Packing',
  shipped: 'Delivery handover', delivered: 'Delivered', rejected: 'Rejected',
  cancelled: 'Cancelled', expired: 'Expired', return_pending: 'Return pending',
}
export const NEXT_STATUSES = {
  pending: ['confirmed', 'rejected', 'cancelled'], confirmed: ['packing', 'cancelled'],
  packing: ['shipped', 'cancelled'], shipped: ['delivered'],
}
export function money(value) {
  return `${new Intl.NumberFormat('en-US').format(Number(value) || 0)} MMK`
}
export function available(variant) {
  return Math.max(0, Math.floor(variant.available ?? (Number(variant.on_hand) - Number(variant.reserved))))
}
export function productPrice(product) {
  const prices = (product.variants || []).filter((v) => v.active).map((v) => Number(v.price))
  return prices.length ? Math.min(...prices) : 0
}
export function productStock(product) {
  return (product.variants || []).filter((v) => v.active).reduce((sum, v) => sum + available(v), 0)
}
export function sortProducts(products, sort) {
  return [...products].sort((a, b) => {
    switch (sort) {
      case 'oldest': return a.created_at.localeCompare(b.created_at)
      case 'price-asc': return productPrice(a) - productPrice(b)
      case 'price-desc': return productPrice(b) - productPrice(a)
      case 'name': return a.name.localeCompare(b.name)
      case 'stock': return productStock(b) - productStock(a)
      case 'manual': return a.display_order - b.display_order || b.created_at.localeCompare(a.created_at)
      default: return b.created_at.localeCompare(a.created_at)
    }
  })
}

export function validateGuide(guide) {
  if (!guide.name?.trim()) throw new Error('A size guide name is required.')
  if (!Array.isArray(guide.fields) || !Array.isArray(guide.sizes)) throw new Error('Invalid guide structure.')
  if (guide.fields.length > 12 || guide.sizes.length > 30) throw new Error('Use at most 12 measurement fields and 30 sizes.')
  const keys = new Set()
  for (const field of guide.fields) {
    if (!/^[a-z][a-z0-9_]{0,29}$/.test(field.key) || !field.label?.trim() || keys.has(field.key) || ['id', 'label'].includes(field.key)) throw new Error('Measurement keys must be unique lowercase names; id and label are reserved.')
    keys.add(field.key)
  }
  const sizes = new Set()
  for (const size of guide.sizes) {
    if (!size.id?.trim() || !size.label?.trim() || sizes.has(size.id)) throw new Error('Size IDs must be unique and have a label.')
    sizes.add(size.id)
    for (const field of guide.fields) {
      const range = size[field.key]
      if (range == null) continue
      if (!Array.isArray(range) || range.length !== 2 || !range.every((n) => Number.isFinite(n) && n >= 0) || range[0] > range[1]) throw new Error(`Invalid range for ${size.label}: ${field.label}.`)
    }
  }
  return guide
}

export function suggestFromGuide(guide, measurements) {
  if (!guide?.sizes?.length) return { suggested: null, confidence: null }
  const scores = guide.sizes.map((size) => {
    let checked = 0; let score = 0; let weightMatch = null
    for (const field of guide.fields) {
      const value = measurements[field.key]
      const range = size[field.key]
      if (value == null || value === '' || !Array.isArray(range)) continue
      checked++
      const match = Number.isFinite(Number(value)) && Number(value) >= range[0] && Number(value) <= range[1]
      if (match) score++
      if (field.key === 'weight') weightMatch = match
    }
    return { size, checked, score, weightMatch }
  })
  const weighted = scores.filter((score) => score.weightMatch === true)
  const candidates = (weighted.length ? weighted : scores).sort((a, b) => b.score - a.score || b.checked - a.checked)
  const best = candidates[0]
  if (!best?.checked || !best.score) return { suggested: null, confidence: null }
  return { suggested: best.size.id, label: best.size.label, confidence: best.score === best.checked ? 'high' : 'partial' }
}
