import {cartKey,modifierIds} from './recipe.js'
export function cleanCart(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 30).filter((item) => item && typeof item.variant_id === 'string' && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 100 && item.measurements && typeof item.measurements === 'object' && !Array.isArray(item.measurements) && (item.modifier_option_ids===undefined||Array.isArray(item.modifier_option_ids)&&item.modifier_option_ids.length<=100&&item.modifier_option_ids.every(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(id)))).map((item) => ({ variant_id: item.variant_id, quantity: item.quantity, measurements: item.measurements, ...(item.modifier_option_ids?.length?{modifier_option_ids:modifierIds(item)}:{}) }))
}
export function addCartItem(cart, item, stock) {
  if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) throw new Error('Choose a whole quantity from 1 to 100.')
  const existing = cart.find((line) => cartKey(line) === cartKey(item))
  const quantity = item.quantity + (existing?.quantity || 0)
  if (quantity > stock || quantity > 100) throw new Error(`Only ${Math.min(stock, 100)} available for this variant.`)
  if (existing) return cart.map((line) => line === existing ? { ...line, quantity, measurements: item.measurements } : line)
  if (cart.length >= 30) throw new Error('Your cart can contain up to 30 variants.')
  return [...cart, item]
}
