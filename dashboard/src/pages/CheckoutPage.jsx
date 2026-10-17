import { useState } from 'react'
import { useNavigate, Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import { useCart } from '../services/cart-context.js'
import { useStore } from '../services/store-context.js'
import { shopId } from '../services/client.js'
import { newTrackingToken, submitOrder, trackingHash } from '../services/orders.js'
import { available, money } from '../../shared/catalog.js'
import OrderForm from '../components/OrderForm.jsx'
import CheckoutVerification from '../components/CheckoutVerification.jsx'

const storageKey = `os-checkout:${shopId}`
function readPending() { try { const value = JSON.parse(sessionStorage.getItem(storageKey)); return value?.request_key && value?.tracking_token && value?.customer && Array.isArray(value?.items) ? value : null } catch { return null } }
export default function CheckoutPage() {
  const navigate = useNavigate(); const queryClient = useQueryClient(); const { cart, lines, clear } = useCart(); const { settings, configured, loading, error: storeError } = useStore()
  const [pending, setPending] = useState(readPending); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [challenge, setChallenge] = useState(''); const [attempt, setAttempt] = useState(0)
  if (loading) return <CircularProgress aria-label="Loading checkout" />
  if (!configured || storeError || settings?.checkout_enabled === false || (settings?.verification_required && !import.meta.env.VITE_TURNSTILE_SITE_KEY)) return <Alert severity="warning">Online ordering is unavailable. Please contact the shop.</Alert>
  const invalid = lines.some((line) => !line.variant || !line.selection.valid || line.stock_loading || line.quantity > available(line.variant))
  // Retries display the submitted cart snapshot, even if another tab edits the live cart.
  const summary = pending?.summary || (pending ? pending.items.map((item) => ({ ...item, name: 'Requested item', price: null })) : lines.map((line) => ({ variant_id: line.variant_id, quantity: line.quantity, name: line.product?.name || 'Unavailable item', color: line.variant?.color, size: line.variant?.size, price: line.variant ? line.selected_price : null,modifiers:line.selection.options.map(option=>option.name) })))
  const subtotal = summary.every((item) => item.price !== null) ? summary.reduce((sum, item) => sum + item.price * item.quantity, 0) : null
  const deliveryFee = Number(pending?.delivery_fee ?? settings.delivery_fee)
  async function place(values) {
    if (busy) return
    if (!pending && (!cart.length || invalid)) { setError('Review your cart before ordering.'); return }
    if (import.meta.env.VITE_TURNSTILE_SITE_KEY && !challenge) { setError('Please complete verification.'); return }
    setBusy(true); setError('')
    const request = pending || { request_key: crypto.randomUUID(), tracking_token: newTrackingToken(), customer: { name: values.name.trim(), phone: values.phone.trim(), city: values.city.trim(), address: values.address.trim() }, note: values.note || '', items: cart.map(({ variant_id, quantity, measurements,modifier_option_ids }) => ({ variant_id, quantity, measurements,...(modifier_option_ids?.length?{modifier_option_ids}:{}) })), summary, delivery_fee: deliveryFee }
    setPending(request)
    try { sessionStorage.setItem(storageKey, JSON.stringify(request)) } catch { /* In-memory retries retain the same key during this page session. */ }
    try {
      const result = await submitOrder(request, challenge)
      if (!result?.reference || !result?.tracking_token) throw new Error('Order response is incomplete. Retry this request.')
      try {
        const key = `os-orders:${shopId}`; const previous = JSON.parse(localStorage.getItem(key) || '[]')
        const recent = Array.isArray(previous) ? previous : []
        localStorage.setItem(key, JSON.stringify([{ reference: result.reference, token: result.tracking_token }, ...recent.filter((order) => order.reference !== result.reference)].slice(0, 10)))
      } catch { /* The private tracking link remains available on the confirmation screen. */ }
      try { sessionStorage.removeItem(storageKey) } catch { /* Storage may be disabled. */ }
      clear(); await queryClient.invalidateQueries({ queryKey: ['catalog'] })
      navigate(`/order/success#${trackingHash(result.reference, result.tracking_token)}`, { replace: true })
    } catch (error) {
      setError(error.message); setChallenge(''); setAttempt((value) => value + 1)
      // Only a known new-order rollback lets the shopper change the submitted cart.
      // Network failures remain uncertain, so retain the original key/payload for retry.
      if (error.definitive) { setPending(null); try { sessionStorage.removeItem(storageKey) } catch { /* No stored request to clear. */ } }
    }
    finally { setBusy(false) }
  }
  if (!cart.length && !pending) return <Box><Typography>Your cart is empty.</Typography><Button component={Link} to="/">Browse collection</Button></Box>
  return <Stack spacing={3}><Typography variant="h1">Checkout</Typography>{error && <Alert severity="error">{error}</Alert>}
    {pending && <Alert severity="info">This order request is saved for retry. Keep using this request if the connection was interrupted.</Alert>}
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.2fr 0.8fr' }, gap: 3 }}>
      <Paper variant="outlined" sx={{ p: 3 }}><Stack spacing={2}><OrderForm key={pending?.request_key || 'new'} defaults={pending ? { ...pending.customer, note: pending.note } : undefined} locked={!!pending} busy={busy || (!pending && invalid)} onSubmit={place} /><CheckoutVerification onToken={setChallenge} resetKey={attempt} /></Stack></Paper>
      <Paper variant="outlined" sx={{ p: 3, alignSelf: 'start' }}><Stack spacing={2}>{summary.map((item,index) => <Box key={index}><Typography>{item.name} · {item.color} / {item.size} × {item.quantity}</Typography>{item.modifiers?.length>0&&<Typography variant="body2" color="text.secondary">{item.modifiers.join(', ')}</Typography>}</Box>)}{subtotal !== null && <><Typography>Subtotal: {money(subtotal)}</Typography><Typography>Delivery: {money(deliveryFee)}</Typography><Typography variant="h6">Estimated total: {money(subtotal + deliveryFee)}</Typography></>}<Typography variant="body2" color="text.secondary">The final price is checked when your request is processed. The shop will confirm your order after reviewing it.</Typography>{!pending && <Button component={Link} to="/cart">Edit cart</Button>}</Stack></Paper>
    </Box>
  </Stack>
}
