import { useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField } from '@mui/material'
import ChatOutlinedIcon from '@mui/icons-material/ChatOutlined'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import CallOutlinedIcon from '@mui/icons-material/CallOutlined'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { useStore } from '../services/store-context.js'
import { productInquiry, shopContact } from '../../shared/contact.js'
export default function ProductContact({ product, color, size }) {
  const { settings } = useStore()
  const [open, setOpen] = useState(false), [notice, setNotice] = useState(null)
  const contact = shopContact(settings?.phone), message = productInquiry(product, color, size)
  if (!contact) return null
  const copy = async (value, label) => {
    try { await navigator.clipboard.writeText(value); setNotice({ severity: 'success', text: label + ' copied.' }) }
    catch { setNotice({ severity: 'info', text: 'Select the text below to copy it.' }) }
  }
  return <>
    <Button variant="text" startIcon={<ChatOutlinedIcon />} onClick={() => { setOpen(true); setNotice(null) }} sx={{ alignSelf: 'flex-start', px: 0, fontSize: 12 }}>Ask on Viber</Button>
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs" aria-labelledby="product-contact-title"><DialogTitle id="product-contact-title" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 20 }}>Contact on Viber<IconButton aria-label="Close contact" onClick={() => setOpen(false)}><CloseRoundedIcon /></IconButton></DialogTitle><DialogContent><Stack spacing={2}>
      {notice && <Alert severity={notice.severity}>{notice.text}</Alert>}
      <TextField label="Product details" multiline minRows={3} value={message} slotProps={{ input: { readOnly: true } }} onFocus={event => event.target.select()} />
      <Button variant="outlined" startIcon={<ContentCopyRoundedIcon />} onClick={() => void copy(message, 'Product details')}>Copy product details</Button>
      <TextField label="Shop phone" value={contact.phone} slotProps={{ input: { readOnly: true } }} onFocus={event => event.target.select()} />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}><Button startIcon={<ContentCopyRoundedIcon />} onClick={() => void copy(contact.phone, 'Phone number')}>Copy phone</Button><Button component="a" href={contact.call} startIcon={<CallOutlinedIcon />}>Call shop</Button></Box>
    </Stack></DialogContent><DialogActions sx={{ px: 3, pb: 3 }}><Button component="a" href={contact.viber} variant="contained" startIcon={<ChatOutlinedIcon />} fullWidth>Open Viber</Button></DialogActions></Dialog>
  </>
}
