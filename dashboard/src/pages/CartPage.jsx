import { useStoreLanguage } from '../services/language.js'
import { useState } from 'react'
import { Link } from 'react-router'
import { Alert, Box, Button, CircularProgress, IconButton, Stack, TextField, Typography } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined'
import { useCart } from '../services/cart-context.js'
import { useStore } from '../services/store-context.js'
import { useStorefrontUi } from '../services/storefront-ui.js'
import { available, money } from '../../shared/catalog.js'
import { cartKey } from '../../shared/recipe.js'
export default function CartPage({ embedded = false, onClose }) {
  const { t } = useStoreLanguage()
  const { lines, update, remove, count } = useCart(), { loading, error } = useStore(), { overlayState } = useStorefrontUi()
  const [message, setMessage] = useState('')
  if (loading) return <CircularProgress aria-label={t('Loading cart')} />
  if (error) return <Alert severity="error">{t('Unable to refresh stock. Please try again.')}</Alert>
  const invalid = lines.some(line => !line.variant || !line.selection.valid || line.stock_loading || line.quantity > available(line.variant))
  const subtotal = lines.reduce((sum,line) => sum + (line.variant ? line.selected_price * line.quantity : 0),0)
  const change = (line,value) => { try { update(cartKey(line),Number(value)); setMessage('') } catch(error) { setMessage(error.message) } }
  return <Stack sx={{ height: embedded ? '100%' : undefined, minHeight: 0, maxWidth: embedded ? undefined : 760, mx: embedded ? undefined : 'auto' }}>
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', minHeight: { xs: 65, md: 82 }, px: { xs: 2.25, md: 3.25 }, borderBottom: '1px solid', borderColor: 'divider' }}><Typography component="h1" sx={{ fontFamily: 'Georgia,serif', fontSize: 27, fontWeight: 400 }}>{t('Your bag')} <Box component="span" sx={{ fontFamily: 'system-ui', fontSize: 14, color: '#999' }}>({count})</Box></Typography>{onClose && <IconButton aria-label={t('Close cart')} onClick={onClose}><CloseRoundedIcon /></IconButton>}</Stack>
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: { xs: 2.5, md: '25px' } }}>
      {message && <Alert severity="error" sx={{ mb: 2 }}>{t(message)}</Alert>}
      {lines.map(line => {
        const image = line.product?.images?.find(image => image.color === line.variant?.color) || line.product?.images?.find(image => image.is_cover) || line.product?.images?.[0]
        return <Box key={cartKey(line)} sx={{ display: 'grid', gridTemplateColumns: '79px minmax(0,1fr)', gap: '15px', borderBottom: '1px solid', borderColor: 'divider', pb: 2.5, mb: 2.5 }}>
          {image?.src ? <Box component="img" src={image.src} alt={line.product?.name} sx={{ width: 79, height: 105, objectFit: 'cover' }} /> : <Box sx={{ width: 79, height: 105, bgcolor: '#f0ece7' }} />}
          <Box sx={{ minWidth: 0 }}><Typography component="h2" sx={{ fontFamily: 'Georgia,serif', fontSize: 16, fontWeight: 400, mb: .75 }}>{line.product?.name || t('Unavailable product')}</Typography>{line.variant && <><Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{line.variant.color} / {line.variant.size}</Typography><Typography sx={{ fontSize: 12, fontWeight: 650, mt: .5 }}>{money(line.selected_price)}</Typography></>}
            {line.selection.options.map(option => <Typography key={option.id} sx={{ fontSize: 11, color: 'text.secondary' }}>{option.group_name}: {option.name}</Typography>)}
            {(!line.variant || !line.selection.valid || line.quantity > available(line.variant)) && <Typography color="error" sx={{ fontSize: 12 }}>{t('This selection is no longer available. Update or remove the item.')}</Typography>}
            {line.stock_loading && <Typography sx={{ fontSize: 11 }}>{t('Checking stock…')}</Typography>}{line.stock_error && <Typography color="error" sx={{ fontSize: 12 }}>{t(line.stock_error)}</Typography>}
            <Stack direction="row" spacing={.75} sx={{ alignItems: 'center', mt: 1.25 }}><IconButton aria-label={t('Decrease {name}', { name: line.product?.name })} disabled={line.quantity <= 1} onClick={() => change(line,line.quantity-1)} sx={{ minWidth: 28, minHeight: 28, width: 28, height: 28, border: '1px solid', borderColor: 'divider', borderRadius: 0 }}><RemoveRoundedIcon sx={{ fontSize: 14 }} /></IconButton><TextField type="number" value={line.quantity} variant="standard" onChange={event => change(line,event.target.value)} slotProps={{ htmlInput: { 'aria-label': t('Quantity for {name}', { name: line.product?.name }), min: 1, max: line.variant ? Math.min(100,available(line.variant)) : 1, style: { textAlign: 'center', padding: 0 } }, input: { disableUnderline: true } }} sx={{ width: 28, '& input::-webkit-inner-spin-button': { WebkitAppearance: 'none' } }} /><IconButton aria-label={t('Increase {name}', { name: line.product?.name })} disabled={!line.variant || line.stock_loading || line.quantity >= Math.min(100,available(line.variant))} onClick={() => change(line,line.quantity+1)} sx={{ minWidth: 28, minHeight: 28, width: 28, height: 28, border: '1px solid', borderColor: 'divider', borderRadius: 0 }}><AddRoundedIcon sx={{ fontSize: 14 }} /></IconButton><Button onClick={() => remove(cartKey(line))} sx={{ ml: 'auto!important', minWidth: 0, minHeight: 28, p: .25, fontSize: 11, color: '#957d76', textDecoration: 'underline' }}>{t('Remove')}</Button></Stack>
          </Box>
        </Box>
      })}
      {!lines.length && <Box sx={{ textAlign: 'center', py: 7 }}><ShoppingBagOutlinedIcon sx={{ fontSize: 48, color: '#b5aca5' }} /><Typography variant="h2" sx={{ fontSize: 25, my: 2 }}>{t('Your bag is empty')}</Typography><Button component={Link} to="/" variant="outlined">{t('Continue shopping')}</Button></Box>}
    </Box>
    {!!lines.length && <Box sx={{ borderTop: '1px solid', borderColor: 'divider', p: { xs: 2.5, md: '22px 25px 30px' } }}><Stack direction="row" sx={{ justifyContent: 'space-between', mb: 2 }}><Typography sx={{ fontWeight: 650 }}>{t('Subtotal')}</Typography><Typography sx={{ fontWeight: 650 }}>{money(subtotal)}</Typography></Stack><Button component={Link} to="/checkout" state={overlayState} variant="contained" fullWidth disabled={invalid} sx={{ fontSize: 12, fontWeight: 750, letterSpacing: '.04em' }}>{t('CHECKOUT')}</Button></Box>}
  </Stack>
}
