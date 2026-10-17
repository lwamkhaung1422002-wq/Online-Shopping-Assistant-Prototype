// Match the POS API's normalizeCustomerPhone without making phone a credential.
export function normalizeTrackingPhone(value) {
  const digits = String(value || '').normalize('NFKC').replace(/[၀-၉]/g, digit => String(digit.charCodeAt(0) - 0x1040)).replace(/\D/g, '')
  return digits.startsWith('0095') ? `0${digits.slice(4)}` : digits.startsWith('95') ? `0${digits.slice(2)}` : digits
}

export function readTrackingHistory(storage, shop) {
  try {
    const entries = JSON.parse(storage.getItem(`os-orders:${shop}`) || '[]')
    if (!Array.isArray(entries)) return []
    const seen = new Set()
    return entries.filter(entry => {
      if (!entry || typeof entry.reference !== 'string' || !entry.reference.trim() || typeof entry.token !== 'string' || !/^[a-f0-9]{64}$/.test(entry.token) || seen.has(entry.reference)) return false
      seen.add(entry.reference)
      return true
    }).map(entry => ({ reference: entry.reference, token: entry.token, phone: normalizeTrackingPhone(entry.phone) }))
  } catch { return [] }
}

export function rememberTrackingOrder(storage, shop, result, phone) {
  if (!result || typeof result.reference !== 'string' || !result.reference.trim() || !/^[a-f0-9]{64}$/.test(result.tracking_token || '')) return false
  try {
    const previous = readTrackingHistory(storage, shop)
    const normalized = normalizeTrackingPhone(phone) || previous.find(entry => entry.reference === result.reference)?.phone || ''
    storage.setItem(`os-orders:${shop}`, JSON.stringify([{ reference: result.reference, token: result.tracking_token, phone: normalized }, ...previous.filter(entry => entry.reference !== result.reference)]))
    return true
  } catch { return false }
}

export function ordersForPhone(entries, phone) {
  const normalized = normalizeTrackingPhone(phone)
  return normalized ? entries.filter(entry => entry.phone === normalized) : []
}
