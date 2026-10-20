import { useState } from 'react'
import { useLocation, Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material'
import { trackOrder } from '../services/orders.js'
import { shopId, configured } from '../services/client.js'
import { money, ORDER_LABELS } from '../../shared/catalog.js'
import { normalizeTrackingPhone, ordersForPhone, readTrackingHistory } from '../services/tracking-history.js'
import { useStoreLanguage } from '../services/language.js'
import { useStorefrontUi } from '../services/storefront-ui.js'

function Details({ reference, token, confirmation, onBack }) {
  const { t, dateLocale } = useStoreLanguage(), { overlayState } = useStorefrontUi()
  const query = useQuery({ queryKey: ['tracking', reference, token], queryFn: () => trackOrder(reference, token), enabled: configured && !!reference && /^[a-f0-9]{64}$/.test(token), staleTime: 0, refetchInterval: 30000, retry: false })
  if (!configured) return <Alert severity="info">{t('Order tracking is not available yet.')}</Alert>
  if (!reference || !/^[a-f0-9]{64}$/.test(token)) return <Alert severity="error">{t('Use the complete private tracking link.')}</Alert>
  if (query.isPending) return <CircularProgress aria-label={t('Loading order')} />
  if (query.isError) return <Alert severity="error">{t(query.error.message)}</Alert>
  const order = query.data
  return <Stack spacing={3} sx={{minWidth:0,overflowWrap:'anywhere'}}>
    {onBack && <Button onClick={onBack} sx={{ alignSelf: 'flex-start' }}>{t('Back to orders')}</Button>}
    <Typography variant="h1" sx={{ fontSize: { xs: 27, sm: 32 }, pr: 5 }}>{t(confirmation ? 'Order request received' : 'Track your order')}</Typography>
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}><Stack spacing={2}><Chip label={t(ORDER_LABELS[order.status] || order.status)} sx={{ alignSelf: 'start', height: 'auto', minHeight: 32, '& .MuiChip-label': { whiteSpace: 'normal', py: .75 } }} color={order.status === 'delivered' ? 'success' : 'default'} />
      {order.items.map((item, i) => <Box key={i}><Typography>{item.name} · {item.color} / {item.size} × {item.quantity} · {money(Math.max(0,item.unit_price * item.quantity))}</Typography>{item.modifiers?.map((modifier,index)=><Typography key={index} variant="body2" color="text.secondary">{modifier.group_name}: {modifier.name}</Typography>)}</Box>)}
      <Typography sx={{ fontWeight: 700 }}>{t('Total')}: {money(order.total)}</Typography>
      {order.courier && <Typography>{t('Courier')}: {order.courier} {order.delivery_reference && `· ${order.delivery_reference}`}</Typography>}
      <Stack spacing={1} sx={{ pt: 1 }}>{order.events.map((event, i) => <Typography variant="body2" color="text.secondary" key={i}>{t(ORDER_LABELS[event.status] || event.status)} · {new Date(event.created_at).toLocaleString(dateLocale)}</Typography>)}</Stack>
    </Stack></Paper>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>{confirmation && <Button component={Link} to="/track" state={overlayState} variant="contained" sx={{ flex: 1 }}>{t('Track order')}</Button>}<Button component={Link} to="/" variant="outlined" sx={{ flex: 1 }}>{t('Continue shopping')}</Button></Stack>
  </Stack>
}
function SavedOrder({ order, index, onOpen }) {
  const { t, dateLocale } = useStoreLanguage()
  const query = useQuery({ queryKey: ['tracking', order.reference, order.token], queryFn: () => trackOrder(order.reference, order.token), enabled: configured, staleTime: 0, refetchInterval: 30000, retry: false })
  const data = query.data
  return <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}><Stack spacing={1.5}>
    <Typography variant="h6">{data?.items?.map(item => item.name).join(', ') || t('Order {number}', { number: index + 1 })}</Typography>
    {query.isPending && <Typography color="text.secondary">{t('Loading order…')}</Typography>}
    {query.isError && <Alert severity="error">{t(query.error.message)}</Alert>}
    {data && <><Chip label={t(ORDER_LABELS[data.status] || data.status)} variant="outlined" sx={{ alignSelf: 'flex-start' }} /><Typography>{money(data.total)}</Typography>{data.events?.[0]?.created_at && <Typography variant="body2" color="text.secondary">{new Date(data.events[0].created_at).toLocaleString(dateLocale)}</Typography>}</>}
    <Button variant="outlined" onClick={() => onOpen(order)} sx={{ alignSelf: 'flex-start' }}>{t('View order {number}', { number: index + 1 })}</Button>
  </Stack></Paper>
}
export default function TrackingPage({ confirmation = false }) {
  const { t } = useStoreLanguage()
  const { hash } = useLocation(); const params = new URLSearchParams(hash.slice(1))
  const reference = params.get('reference') || ''; const token = params.get('token') || ''
  const [phone, setPhone] = useState(''); const [searchedPhone, setSearchedPhone] = useState(''); const [selected, setSelected] = useState(null)
  const [failure, setFailure] = useState('')
  const [recent] = useState(() => { try { return readTrackingHistory(localStorage, shopId) } catch { return [] } })
  const current = reference && /^[a-f0-9]{64}$/.test(token) ? { reference, token } : selected
  if (current) return <Details key={current.reference + current.token} {...current} confirmation={confirmation} onBack={selected ? () => setSelected(null) : undefined} />
  const matches = ordersForPhone(recent, searchedPhone)
  const earlier = recent.filter(order => !order.phone)
  return <Stack spacing={3} sx={{ minWidth: 0 }}><Typography variant="h1" sx={{ pr: 5 }}>{t('Track your order')}</Typography>
    {!configured && <Alert severity="info">{t('Order tracking is not available yet.')}</Alert>}
    <Stack component="form" spacing={2} onSubmit={event => {
      event.preventDefault()
      const normalized = normalizeTrackingPhone(phone)
      if (!/^09\d{7,9}$/.test(normalized)) { setFailure('Enter a valid Myanmar 09 phone number.'); setSearchedPhone(''); return }
      setFailure(''); setSearchedPhone(normalized)
    }} sx={{ maxWidth: 600 }}>
      <TextField label={t('Phone')} type="tel" autoComplete="tel" value={phone} required onChange={event => { setPhone(event.target.value); setSearchedPhone(''); setFailure('') }} error={!!failure} helperText={failure ? t(failure) : undefined} />
      <Button type="submit" variant="contained">{t('Track order')}</Button>
    </Stack>
    {searchedPhone && (matches.length ? <Stack spacing={2}>{matches.map((order, index) => <SavedOrder key={order.reference} order={order} index={index} onOpen={setSelected} />)}</Stack> : <Alert severity="info">{t('No saved orders match this phone on this browser. Contact the shop for assistance.')}</Alert>)}
    {earlier.length > 0 && <Box><Typography variant="h6" sx={{ mb: 2 }}>{t('Earlier orders on this browser')}</Typography><Stack spacing={2}>{earlier.map((order, index) => <SavedOrder key={order.reference} order={order} index={index} onOpen={setSelected} />)}</Stack></Box>}
  </Stack>
}
