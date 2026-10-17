import { useState } from 'react'
import { useLocation, Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material'
import { trackOrder, trackingHash } from '../services/orders.js'
import { shopId, configured } from '../services/client.js'
import { money, ORDER_LABELS } from '../../shared/catalog.js'

function Details({ reference, token, confirmation }) {
  const query = useQuery({ queryKey: ['tracking', reference, token], queryFn: () => trackOrder(reference, token), enabled: configured && !!reference && /^[a-f0-9]{64}$/.test(token), refetchInterval: 30000, retry: false })
  const [copied, setCopied] = useState(false)
  if (!configured) return <Alert severity="info">Order tracking is not available yet.</Alert>
  if (!reference || !/^[a-f0-9]{64}$/.test(token)) return <Alert severity="error">Use the complete private tracking link.</Alert>
  if (query.isPending) return <CircularProgress aria-label="Loading order" />
  if (query.isError) return <Alert severity="error">{query.error.message}</Alert>
  const order = query.data
  const link = `${window.location.origin}/track#${trackingHash(reference, token)}`
  async function copy() { try { await navigator.clipboard.writeText(link); setCopied(true) } catch { setCopied(false) } }
  return <Stack spacing={3} sx={{minWidth:0,overflowWrap:'anywhere'}}>
    <Typography variant="h1">{confirmation ? 'Order request received' : 'Track your order'}</Typography>
    <Paper variant="outlined" sx={{ p: 3 }}><Stack spacing={2}><Typography variant="h6">{order.reference}</Typography><Chip label={ORDER_LABELS[order.status]} sx={{ alignSelf: 'start' }} color={order.status === 'delivered' ? 'success' : 'default'} />
      {order.status === 'pending' && <Typography color="text.secondary">The shop is reviewing your request. Your order is confirmed when its status changes to Confirmed.</Typography>}
      {order.items.map((item, i) => <Box key={i}><Typography>{item.name} · {item.color} / {item.size} × {item.quantity} · {money(Math.max(0,item.unit_price * item.quantity))}</Typography>{item.modifiers?.map((modifier,index)=><Typography key={index} variant="body2" color="text.secondary">{modifier.group_name}: {modifier.name}</Typography>)}</Box>)}
      <Typography>Delivery: {money(order.delivery_fee)}</Typography><Typography sx={{ fontWeight: 700 }}>Total: {money(order.total)}</Typography>
      {order.courier && <Typography>Courier: {order.courier} {order.delivery_reference && `· ${order.delivery_reference}`}</Typography>}
      <Stack spacing={1} sx={{ pt: 1 }}>{order.events.map((event, i) => <Typography variant="body2" key={i}>{ORDER_LABELS[event.status]} · {new Date(event.created_at).toLocaleString()}</Typography>)}</Stack>
    </Stack></Paper>
    <Typography variant="body2" color="text.secondary">Keep your private tracking link. Anyone with this link can view this order's status.</Typography>
    <TextField label="Private tracking link" value={link} slotProps={{ input: { readOnly: true } }} onFocus={(e) => e.target.select()} />
    <Box><Button onClick={copy} variant="outlined">{copied ? 'Copied' : 'Copy tracking link'}</Button><Button component={Link} to="/">Continue shopping</Button></Box>
  </Stack>
}
export default function TrackingPage({ confirmation = false }) {
  const { hash } = useLocation(); const params = new URLSearchParams(hash.slice(1))
  const reference = params.get('reference') || ''; const token = params.get('token') || ''
  const [inputReference, setReference] = useState(''); const [inputToken, setToken] = useState(''); const [selected, setSelected] = useState(null)
  const [recent] = useState(() => { try { const value = JSON.parse(localStorage.getItem(`os-orders:${shopId}`) || '[]'); return Array.isArray(value) ? value.slice(0, 10).filter((o) => typeof o.reference === 'string' && /^[a-f0-9]{64}$/.test(o.token)) : [] } catch { return [] } })
  const current = reference && /^[a-f0-9]{64}$/.test(token) ? { reference, token } : selected
  if (current) return <Details key={current.reference + current.token} {...current} confirmation={confirmation} />
  return <Stack spacing={3}><Typography variant="h1">Track your order</Typography><Typography color="text.secondary">Open the private link from your order confirmation, or enter your reference and tracking token.</Typography>
    <Stack component="form" spacing={2} onSubmit={(e) => { e.preventDefault(); setSelected({ reference: inputReference.trim(), token: inputToken.trim() }) }} sx={{ maxWidth: 600 }}>
      <TextField label="Order reference" value={inputReference} required onChange={(e) => setReference(e.target.value)} />
      <TextField label="Private tracking token" value={inputToken} required onChange={(e) => setToken(e.target.value)} slotProps={{ htmlInput: { pattern: '[a-f0-9]{64}', maxLength: 64 } }} />
      <Button type="submit" variant="contained">Track order</Button>
    </Stack>
    {recent.length > 0 && <><Typography variant="h6">Orders on this device</Typography>{recent.map((order) => <Box key={order.reference}><Button component={Link} to={`/track#${trackingHash(order.reference, order.token)}`}>{order.reference}</Button></Box>)}</>}
  </Stack>
}
