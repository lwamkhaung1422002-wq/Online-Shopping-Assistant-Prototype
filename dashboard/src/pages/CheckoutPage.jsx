import { useState } from 'react'
import { useNavigate, Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import { useCart } from '../services/cart-context.js'
import { useStore } from '../services/store-context.js'
import { shopId } from '../services/client.js'
import { newTrackingToken, submitOrder, trackingHash } from '../services/orders.js'
import { rememberTrackingOrder } from '../services/tracking-history.js'
import { available, money } from '../../shared/catalog.js'
import OrderForm from '../components/OrderForm.jsx'
import CheckoutVerification from '../components/CheckoutVerification.jsx'
import { useStoreLanguage } from '../services/language.js'

const storageKey = `os-checkout:${shopId}`
function readPending() { try { const value = JSON.parse(sessionStorage.getItem(storageKey)); return value?.request_key && value?.tracking_token && value?.customer && Array.isArray(value?.items) ? value : null } catch { return null } }
export default function CheckoutPage({ embedded = false }) {
  const { t } = useStoreLanguage()
  const navigate = useNavigate(); const queryClient = useQueryClient(); const { cart, lines, clear } = useCart(); const { settings, configured, loading, error: storeError } = useStore()
  const [pending, setPending] = useState(readPending); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [challenge, setChallenge] = useState(''); const [attempt, setAttempt] = useState(0)
  if (loading) return <CircularProgress aria-label={t('Loading checkout')} />
  if (!configured || storeError || settings?.checkout_enabled === false || (settings?.verification_required && !import.meta.env.VITE_TURNSTILE_SITE_KEY)) return <Alert severity="warning">{t('Online ordering is unavailable. Please contact the shop.')}</Alert>
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
        rememberTrackingOrder(localStorage, shopId, result, request.customer.phone)
      } catch { /* The private tracking link remains available on the confirmation screen. */ }
      try { sessionStorage.removeItem(storageKey) } catch { /* Storage may be disabled. */ }
      clear(); await queryClient.invalidateQueries({ queryKey: ['catalog'] })
      navigate(`/order/success#${trackingHash(result.reference, result.tracking_token)}`, { replace: true, ...(embedded ? { state: { backgroundLocation: { pathname: '/' } } } : {}) })
    } catch (error) {
      setError(error.message); setChallenge(''); setAttempt((value) => value + 1)
      // Only a known new-order rollback lets the shopper change the submitted cart.
      // Network failures remain uncertain, so retain the original key/payload for retry.
      if (error.definitive) { setPending(null); try { sessionStorage.removeItem(storageKey) } catch { /* No stored request to clear. */ } }
    }
    finally { setBusy(false) }
  }
  if (!cart.length && !pending) return <Box><Typography>{t('Your cart is empty.')}</Typography><Button component={Link} to="/">{t('Browse collection')}</Button></Box>
  return <Stack spacing={2.5} sx={{ maxWidth: embedded ? undefined : 560, mx: embedded ? undefined : 'auto' }}>
    <Typography variant="h1" sx={{ fontSize: { xs: 27, sm: 31 }, pr: embedded ? 5 : 0 }}>{t('Delivery details')}</Typography>{error && <Alert severity="error">{t(error)}</Alert>}
    {pending && <Alert severity="info">{t('Saved request · Retry this order')}</Alert>}
    <OrderForm key={pending?.request_key || 'new'} defaults={pending ? { ...pending.customer, note: pending.note } : undefined} locked={!!pending} busy={busy || (!pending && invalid)} onSubmit={place} actions={!pending && <Button component={Link} to="/cart" state={embedded ? { backgroundLocation: { pathname: '/' } } : undefined} variant="outlined" sx={{ flex: 1, minHeight: 48, px: 1.5 }}>{t('Edit cart')}</Button>}>
    <CheckoutVerification onToken={setChallenge} resetKey={attempt} />
    <Paper variant="outlined" sx={{ p: 2, bgcolor: '#f6f1ed', border: 0 }}><Stack spacing={1}>
      {summary.map((item,index) => <Box key={index}><Typography sx={{ fontSize: 12 }}>{item.name} · {item.color} / {item.size} × {item.quantity}</Typography>{item.modifiers?.length>0 && <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{item.modifiers.join(', ')}</Typography>}</Box>)}
      {subtotal !== null && <><Typography sx={{ fontSize: 12 }}>{t('Subtotal')}: {money(subtotal)}</Typography><Typography sx={{ fontSize: 13, fontWeight: 650 }}>{t('Order total')}: {money(subtotal + deliveryFee)}</Typography></>}
    </Stack></Paper>
    </OrderForm>
  </Stack>
}
