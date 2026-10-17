import { useState } from 'react'
import { useLocation, Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material'
import { trackOrder, trackingHash } from '../services/orders.js'
import { shopId, configured } from '../services/client.js'
import { money, ORDER_LABELS } from '../../shared/catalog.js'
import { normalizeTrackingPhone, ordersForPhone, readTrackingHistory } from '../services/tracking-history.js'

function Details({ reference, token, confirmation, onBack }) {
  const query = useQuery({ queryKey: ['tracking', reference, token], queryFn: () => trackOrder(reference, token), enabled: configured && !!reference && /^[a-f0-9]{64}$/.test(token), staleTime: 0, refetchInterval: 30000, retry: false })
  const [copied, setCopied] = useState(false)
  if (!configured) return <Alert severity="info">Order tracking is not available yet.</Alert>
  if (!reference || !/^[a-f0-9]{64}$/.test(token)) return <Alert severity="error">Use the complete private tracking link.</Alert>
  if (query.isPending) return <CircularProgress aria-label="Loading order" />
  if (query.isError) return <Alert severity="error">{query.error.message}</Alert>
  const order = query.data
  const link = `${window.location.origin}/track#${trackingHash(reference, token)}`
  async function copy() { try { await navigator.clipboard.writeText(link); setCopied(true) } catch { setCopied(false) } }
  return <Stack spacing={3} sx={{minWidth:0,overflowWrap:'anywhere'}}>
    {onBack && <Button onClick={onBack} sx={{ alignSelf: 'flex-start' }}>Back to orders</Button>}
    <Typography variant="h1">{confirmation ? 'Order request received' : 'Track your order'}</Typography>
    <Paper variant="outlined" sx={{ p: 3 }}><Stack spacing={2}><Typography variant="h6">{order.reference}</Typography><Chip label={ORDER_LABELS[order.status]} sx={{ alignSelf: 'start' }} color={order.status === 'delivered' ? 'success' : 'default'} />
      {order.items.map((item, i) => <Box key={i}><Typography>{item.name} · {item.color} / {item.size} × {item.quantity} · {money(Math.max(0,item.unit_price * item.quantity))}</Typography>{item.modifiers?.map((modifier,index)=><Typography key={index} variant="body2" color="text.secondary">{modifier.group_name}: {modifier.name}</Typography>)}</Box>)}
      <Typography>Delivery: {money(order.delivery_fee)}</Typography><Typography sx={{ fontWeight: 700 }}>Total: {money(order.total)}</Typography>
      {order.courier && <Typography>Courier: {order.courier} {order.delivery_reference && `· ${order.delivery_reference}`}</Typography>}
      <Stack spacing={1} sx={{ pt: 1 }}>{order.events.map((event, i) => <Typography variant="body2" key={i}>{ORDER_LABELS[event.status]} · {new Date(event.created_at).toLocaleString()}</Typography>)}</Stack>
    </Stack></Paper>
    <TextField label="Private tracking link" value={link} slotProps={{ input: { readOnly: true } }} onFocus={(e) => e.target.select()} />
    <Box><Button onClick={copy} variant="outlined">{copied ? 'Copied' : 'Copy tracking link'}</Button><Button component={Link} to="/">Continue shopping</Button></Box>
  </Stack>
}
function SavedOrder({ order, index, onOpen }) {
  const query = useQuery({ queryKey: ['tracking', order.reference, order.token], queryFn: () => trackOrder(order.reference, order.token), enabled: configured, staleTime: 0, refetchInterval: 30000, retry: false })
  const data = query.data
  return <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}><Stack spacing={1.5}>
    <Typography variant="h6">{data?.items?.map(item => item.name).join(', ') || `Order ${index + 1}`}</Typography>
    {query.isPending && <Typography color="text.secondary">Loading order…</Typography>}
    {query.isError && <Alert severity="error">{query.error.message}</Alert>}
    {data && <><Chip label={ORDER_LABELS[data.status] || data.status} variant="outlined" sx={{ alignSelf: 'flex-start' }} /><Typography>{money(data.total)}</Typography>{data.events?.[0]?.created_at && <Typography variant="body2" color="text.secondary">{new Date(data.events[0].created_at).toLocaleString()}</Typography>}</>}
    <Button variant="outlined" onClick={() => onOpen(order)} sx={{ alignSelf: 'flex-start' }}>View order {index + 1}</Button>
  </Stack></Paper>
}
export default function TrackingPage({ confirmation = false }) {
  const { hash } = useLocation(); const params = new URLSearchParams(hash.slice(1))
  const reference = params.get('reference') || ''; const token = params.get('token') || ''
  const [phone, setPhone] = useState(''); const [searchedPhone, setSearchedPhone] = useState(''); const [selected, setSelected] = useState(null)
  const [failure, setFailure] = useState('')
  const [recent] = useState(() => { try { return readTrackingHistory(localStorage, shopId) } catch { return [] } })
  const current = reference && /^[a-f0-9]{64}$/.test(token) ? { reference, token } : selected
  if (current) return <Details key={current.reference + current.token} {...current} confirmation={confirmation} onBack={selected ? () => setSelected(null) : undefined} />
  const matches = ordersForPhone(recent, searchedPhone)
  const earlier = recent.filter(order => !order.phone)
  return <Stack spacing={3} sx={{ minWidth: 0 }}><Typography variant="h1">Track your order</Typography>
    {!configured && <Alert severity="info">Order tracking is not available yet.</Alert>}
    <Stack component="form" spacing={2} onSubmit={event => {
      event.preventDefault()
      const normalized = normalizeTrackingPhone(phone)
      if (!/^09\d{7,9}$/.test(normalized)) { setFailure('Enter a valid Myanmar 09 phone number.'); setSearchedPhone(''); return }
      setFailure(''); setSearchedPhone(normalized)
    }} sx={{ maxWidth: 600 }}>
      <TextField label="ဖုန်း / Phone" type="tel" autoComplete="tel" value={phone} required onChange={event => { setPhone(event.target.value); setSearchedPhone(''); setFailure('') }} error={!!failure} helperText={failure || undefined} />
      <Button type="submit" variant="contained">Track order</Button>
    </Stack>
    {searchedPhone && (matches.length ? <Stack spacing={2}>{matches.map((order, index) => <SavedOrder key={order.reference} order={order} index={index} onOpen={setSelected} />)}</Stack> : <Alert severity="info">No saved orders match this phone on this browser. Open the private tracking link from your order confirmation or contact the shop.</Alert>)}
    {earlier.length > 0 && <Box><Typography variant="h6" sx={{ mb: 2 }}>Earlier orders on this browser</Typography><Stack spacing={2}>{earlier.map((order, index) => <SavedOrder key={order.reference} order={order} index={index} onOpen={setSelected} />)}</Stack></Box>}
  </Stack>
}
