import { normalizeTrackingPhone } from '../src/services/tracking-history.js'
export function shopContact(phone) {
  const normalized = normalizeTrackingPhone(phone)
  if (!/^09\d{7,9}$/.test(normalized)) return null
  const international = '+95' + normalized.slice(1)
  return { phone: normalized, call: 'tel:' + international, viber: 'viber://chat?number=' + encodeURIComponent(international) }
}
export function productInquiry(product, color, size) {
  return [product.name, color && 'Color: ' + color, size && 'Size: ' + size].filter(Boolean).join('\n')
}
