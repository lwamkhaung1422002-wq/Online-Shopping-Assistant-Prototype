import { useEffect, useState } from 'react'
import { Alert, Box, Button, Dialog, IconButton, Stack, Tooltip, Typography, useMediaQuery } from '@mui/material'
import ChatOutlinedIcon from '@mui/icons-material/ChatOutlined'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import CallOutlinedIcon from '@mui/icons-material/CallOutlined'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import { useStore } from '../services/store-context.js'
import { productInquiry, shopContact } from '../../shared/contact.js'
import { useStoreLanguage } from '../services/language.js'
import { useStorefrontUi } from '../services/storefront-ui.js'
export default function ProductContact({ product, color, size, quantity }) {
  const { settings } = useStore(), { t } = useStoreLanguage()
  const mobile = useMediaQuery('(max-width:760px)')
  const { setContactOpen } = useStorefrontUi()
  useEffect(() => () => setContactOpen(false), [setContactOpen])
  const [open, setOpen] = useState(false), [copied, setCopied] = useState(''), [notice, setNotice] = useState(false)
  const contact = shopContact(settings?.phone)
  if (!contact) return null
  const count = Number(quantity) > 0 ? Number(quantity) : null
  const message = [productInquiry(product, color, size), count && `Quantity: ${count}`].filter(Boolean).join('\n')
  const photo = product.images?.find(image => image.color === color) || product.images?.find(image => image.is_cover) || product.images?.[0]
  const close = () => { setOpen(false); setContactOpen(false) }
  const copy = async (value, key) => {
    try { await navigator.clipboard.writeText(value); setCopied(key); setNotice(false) }
    catch { setCopied(''); setNotice(true) }
  }
  const content = <Box sx={{ p: { xs: 2.5, sm: 3 }, pb: mobile ? 'calc(24px + env(safe-area-inset-bottom,0px))' : 3 }}>
    {mobile && <Box aria-hidden sx={{ width: 36, height: 4, bgcolor: 'divider', borderRadius: 4, mx: 'auto', mt: -1, mb: 1.5 }} />}
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2.5 }}><Typography id="product-contact-title" component="h2" sx={{ fontSize: 20, fontWeight: 650 }}>{t('Contact the shop')}</Typography><IconButton aria-label={t('Close contact')} onClick={close} sx={{ mr: -.75 }}><CloseRoundedIcon /></IconButton></Stack>
    <Stack spacing={2.5}>
      {notice && <Alert severity="info">{t('Select the text below to copy it.')}</Alert>}
      <Box sx={{ p: 1.5, bgcolor: '#f6f3f0', border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}><Stack direction="row" spacing={1.75} sx={{ alignItems: 'center' }}>
        {photo?.src && <Box component="img" src={photo.src} alt={product.name} sx={{ width: 68, height: 88, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }} />}
        <Box sx={{ minWidth: 0, flex: 1, userSelect: 'text' }}><Typography sx={{ fontSize: 16, fontWeight: 600, overflowWrap: 'anywhere' }}>{product.name}</Typography><Typography sx={{ mt: .4, fontSize: 13, color: 'text.secondary', overflowWrap: 'anywhere' }}>{[color, size].filter(Boolean).join(' · ')}{count ? ` · ${t('Quantity')}: ${count}` : ''}</Typography><Button size="small" startIcon={copied === 'product' ? <CheckRoundedIcon /> : <ContentCopyRoundedIcon />} onClick={() => void copy(message, 'product')} sx={{ mt: .75, px: 0, minHeight: 40, textAlign: 'left', justifyContent: 'flex-start', fontSize: 12, lineHeight: 1.6 }}>{t(copied === 'product' ? 'Copied' : 'Copy product details')}</Button></Box>
      </Stack></Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}><Box sx={{ minWidth: 0 }}><Typography sx={{ fontSize: 12, color: 'text.secondary', mb: .25 }}>{t('Shop phone')}</Typography><Typography sx={{ fontSize: 19, fontWeight: 600, letterSpacing: '.02em', userSelect: 'text', overflowWrap: 'anywhere' }}>{contact.phone}</Typography></Box><Tooltip title={t(copied === 'phone' ? 'Copied' : 'Copy phone')}><IconButton aria-label={t('Copy phone')} onClick={() => void copy(contact.phone, 'phone')} sx={{ bgcolor: '#f6f3f0', borderRadius: 1.5, width: 44, height: 44 }}>{copied === 'phone' ? <CheckRoundedIcon color="success" /> : <ContentCopyRoundedIcon sx={{ fontSize: 20 }} />}</IconButton></Tooltip></Stack>
      <Box role="status" aria-live="polite" sx={{ position: 'absolute', top: 0, left: 0, width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)' }}>{copied ? t('Copied') : ''}</Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.25fr)', gap: 1.25, '@media(max-width:330px)': { gridTemplateColumns: '1fr' } }}><Button component="a" href={contact.call} variant="outlined" startIcon={<CallOutlinedIcon />} sx={{ minHeight: 48, px: 1, borderRadius: 1 }}>{t('Call shop')}</Button><Button component="a" href={contact.viber} variant="contained" startIcon={<ChatOutlinedIcon />} sx={{ minHeight: 48, px: 1, borderRadius: 1, bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' } }}>{t('Open Viber')}</Button></Box>
    </Stack>
  </Box>
  return <>
    <Button variant="outlined" fullWidth startIcon={<ChatOutlinedIcon />} onClick={() => { setContactOpen(true); setOpen(true); setCopied(''); setNotice(false) }} sx={{ minHeight: 46, fontSize: 13, color: 'primary.main', borderColor: 'primary.main' }}>{t('Ask on Viber')}</Button>
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs" aria-labelledby="product-contact-title" sx={{ zIndex: theme => theme.zIndex.modal + 2, ...(mobile ? { '& .MuiDialog-container': { alignItems: 'flex-end' } } : {}) }} slotProps={{ paper: { sx: mobile ? { width: '100%', maxWidth: '100%', m: 0, maxHeight: '88dvh', borderRadius: '20px 20px 0 0' } : { borderRadius: 2 } } }}>{content}</Dialog>
  </>
}
