import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { signInAnonymously } from 'firebase/auth'

const fail = (message, status = 400, code) => { throw Object.assign(new Error(message), { status, code }) }
const identifier = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) fail('Invalid request identifier.'); return value }
const text = (value, max, required = false) => { if (typeof value !== 'string' || value.length > max || required && !value.trim()) fail('Invalid order details.'); return value.trim() }
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(value => value.toString(16).padStart(2, '0')).join('')
export function normalizeDirectOrder(input) {
  const request_key = identifier(input.request_key)
  if (!/^[a-f0-9]{64}$/.test(input.tracking_token || '')) fail('Invalid private tracking token.')
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 40) fail('Use 1–40 cart items.')
  const seen = new Set()
  const items = input.items.map(item => {
    const variant_id = identifier(item.variant_id)
    if (seen.has(variant_id)) fail('Combine duplicate variants before ordering.')
    seen.add(variant_id)
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) fail('Choose a valid whole quantity.')
    if (item.modifier_option_ids?.length) fail('Recipe/modifier checkout needs its direct frozen-allocation conversion.', 501, 'DIRECT_RECIPE_CHECKOUT_PENDING')
    const measurements = item.measurements || {}
    if (typeof measurements !== 'object' || Array.isArray(measurements) || Object.keys(measurements).length > 12 || Object.entries(measurements).some(([key, value]) => !/^[a-z][a-z0-9_]{0,29}$/.test(key) || !Number.isFinite(value) || value < 0 || value > 10000)) fail('Invalid measurements.')
    return { variant_id, quantity: item.quantity, measurements }
  }).sort((a, b) => a.variant_id.localeCompare(b.variant_id))
  const customer = Object.fromEntries(['name', 'phone', 'city', 'address'].map(key => [key, text(input.customer?.[key], key === 'address' ? 1000 : 160, true)]))
  return { request_key, tracking_token: input.tracking_token, customer, note: text(input.note || '', 1000), items }
}

export function prepareDirectBooking(input, book) {
  if (book?.checkout_enabled !== true) fail('Online ordering is disabled.', 409)
  const changes = { ...book.variants }
  const items = input.items.map((item, index) => {
    const source = book.variants?.[item.variant_id]
    if (!source?.active) fail('A selected product is unavailable.', 409)
    if (source.booking_kind !== 'STANDARD') fail('This stock choice needs its frozen identity/recipe conversion.', 501, 'DIRECT_TRACKED_CHECKOUT_PENDING')
    if (!Number.isSafeInteger(source.available) || source.available < item.quantity) fail('Quantity exceeds available stock.', 409)
    if (!Number.isSafeInteger(source.price) || source.price < 0 || !Number.isSafeInteger(source.guest_reserved) || source.guest_reserved < 0) fail('Shared stock requires reconciliation.', 409)
    changes[item.variant_id] = { ...source, available: source.available - item.quantity, guest_reserved: source.guest_reserved + item.quantity }
    return { id: `${input.request_key}-${index}`, variant_id: item.variant_id, product_id: source.product_id,
      product_name: source.product_name, color: source.color, size: source.size, quantity: item.quantity, unit_price: source.price, measurements: item.measurements }
  })
  if (!Number.isSafeInteger(book.delivery_fee) || book.delivery_fee < 0) fail('Delivery terms require reconciliation.', 409)
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0), total = subtotal + book.delivery_fee
  if (!Number.isSafeInteger(total)) fail('Order total exceeds its supported range.')
  return { items, variants: changes, subtotal, total, delivery_fee: book.delivery_fee }
}

export function createDirectOrderRepository({ db, auth, sdk = { doc, getDoc, runTransaction, serverTimestamp }, authenticate = async () => {
  if (!auth.currentUser) await signInAnonymously(auth)
  return auth.currentUser
} }) {
  const root = 'onlineShopV2/belle-online', ref = (table, key) => sdk.doc(db, `${root}/${table}/${key}`)
  async function submit(request) {
    // This unused quantity/price prototype is not connected or Rules-verified.
    // Frozen FIFO/cost/identity preservation must replace it before activation.
    if (!db.app.options.projectId.startsWith('demo-')) fail('Direct checkout is waiting for the frozen stock-allocation conversion.', 503, 'DIRECT_CHECKOUT_FROZEN_ALLOCATIONS_PENDING')
    const input = normalizeDirectOrder(request), user = await authenticate()
    if (!user?.uid || !user.isAnonymous) fail('Customer session could not be established.', 401)
    const hash = await sha(JSON.stringify(input)), reference = `OS-${(await sha(input.request_key)).slice(0, 32).toUpperCase()}`
    let newRequest = false
    try {
      return await sdk.runTransaction(db, async tx => {
        if (auth.currentUser?.uid !== user.uid) fail('The customer session changed.', 401)
        const target = ref('guest_orders', input.request_key), previous = await tx.get(target)
        newRequest = !previous.exists()
        if (previous.exists()) {
          if (previous.data().input_hash !== hash) fail('This request key was already used with different details.', 409)
          return { reference: previous.data().reference, tracking_token: input.tracking_token }
        }
        const bookRef = ref('public_checkout_book', 'main'), snapshot = await tx.get(bookRef), claimRef = ref('guest_reference_claims', reference), claim = await tx.get(claimRef)
        if (claim.exists()) fail('This order reference is already used.', 409)
        const book = snapshot.data(), prepared = prepareDirectBooking(input, book), stamp = sdk.serverTimestamp()
        const order = { id: input.request_key, created_by: user.uid, input_hash: hash, reference, tracking_token: input.tracking_token,
          status: 'pending', customer_name: input.customer.name, phone: input.customer.phone, city: input.customer.city, address: input.customer.address, note: input.note,
          items: prepared.items, variant_ids: prepared.items.map(item => item.variant_id), subtotal: prepared.subtotal, delivery_fee: prepared.delivery_fee, total: prepared.total,
          created_at: stamp, expires_minutes: 30, reservation_state: 'quantity-preview' }
        tx.set(bookRef, { ...book, variants: prepared.variants, version: book.version + 1, last_request_id: input.request_key, last_actor_uid: user.uid })
        tx.set(target, order)
        tx.set(claimRef, { order_id: input.request_key, created_by: user.uid })
        tx.set(ref('guest_tracking', input.tracking_token), { order_id: input.request_key, reference, status: 'pending', created_at: stamp,
          items: prepared.items.map(({ product_name, color, size, quantity, unit_price }) => ({ name: product_name, color, size, quantity, unit_price })),
          delivery_fee: prepared.delivery_fee, total: prepared.total, courier: '', delivery_reference: '', events: [] })
        return { reference, tracking_token: input.tracking_token }
      })
    } catch (error) {
      error.definitive = newRequest && error.status === 409
      throw error
    }
  }
  async function track(reference, token) {
    if (!/^OS-[A-F0-9]{32}$/.test(reference) || !/^[a-f0-9]{64}$/.test(token)) fail('Order not found.', 404)
    const stored = await sdk.getDoc(ref('guest_tracking', token)), value = stored.data()
    if (!value || value.reference !== reference) fail('Order not found.', 404)
    const date = value.created_at?.toDate?.().toISOString() || value.created_at
    return { reference: value.reference, status: value.status, created_at: date, items: value.items,
      delivery_fee: value.delivery_fee, total: value.total, courier: value.courier || '', delivery_reference: value.delivery_reference || '',
      events: value.events.map(event => ({ ...event, created_at: event.created_at?.toDate?.().toISOString() || event.created_at })) }
  }
  return { submit, track }
}
