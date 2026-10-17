// Compare prices from the same resolved variant; never combine unrelated sizes/colors.
export function variantOffer(variant) {
  const price = Number(variant?.price) || 0
  const originalPrice = Number(variant?.original_price)
  const discounted = Number.isFinite(originalPrice) && originalPrice > price && price >= 0
  const saving = discounted ? originalPrice - price : 0
  return { price, originalPrice: discounted ? originalPrice : null, saving,
    percent: discounted ? Math.round(saving / originalPrice * 1000) / 10 : 0 }
}
export function productOffer(product, color) {
  const variants = (product.variants || []).filter(v => v.active && (!color || v.color === color))
  const lowest = variants.reduce((best, variant) => !best || Number(variant.price) < Number(best.price) ? variant : best, null)
  return variantOffer(lowest)
}
