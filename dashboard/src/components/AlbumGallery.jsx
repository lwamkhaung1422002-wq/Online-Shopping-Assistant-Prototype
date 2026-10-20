import { useStoreLanguage } from '../services/language.js'
import { useRef, useState } from 'react'
import { Box, ButtonBase, Dialog, IconButton, Stack, Typography } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import ZoomInOutlinedIcon from '@mui/icons-material/ZoomInOutlined'
import ZoomOutOutlinedIcon from '@mui/icons-material/ZoomOutOutlined'
export default function AlbumGallery({ product, color }) {
  const { t } = useStoreLanguage()
  const images = product.images || []
  const [selected, setSelected] = useState(() => Math.max(0, color ? images.findIndex(image => image.color === color) : images.findIndex(image => image.is_cover)))
  const [open, setOpen] = useState(false), [zoom, setZoom] = useState(false)
  const touch = useRef(null)
  const move = direction => { setZoom(false); setSelected(current => (current + direction + images.length) % images.length) }
  if (!images.length) return <Box sx={{ minHeight: 300, bgcolor: '#f0ece7' }} />
  return <Box sx={{ minWidth: 0, bgcolor: '#f0ece7' }}>
    <ButtonBase aria-label={t('Open product photo')} onClick={() => setOpen(true)} sx={{ display: 'block', width: '100%', height: { xs: '47dvh', md: 520 } }}><Box component="img" src={images[selected].src} alt={images[selected].alt || product.name} sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 24%' }} /></ButtonBase>
    <Box sx={{ display: 'flex', p: 1.5, gap: 1, overflowX: 'auto', bgcolor: '#fff' }}>{images.map((image,index) => <ButtonBase key={image.id || index} aria-label={t('View photo {number}', { number: index + 1 })} aria-pressed={selected === index} onClick={() => setSelected(index)} sx={{ width: 57, height: 69, border: selected === index ? '2px solid' : '1px solid', borderColor: selected === index ? 'primary.main' : '#ddd', flexShrink: 0 }}><Box component="img" src={image.src} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} /></ButtonBase>)}</Box>
    <Dialog open={open} onClose={() => setOpen(false)} fullScreen slotProps={{ paper: { 'aria-label': t('Product photos') } }} onKeyDown={event => { if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1) }}>
      <Stack direction="row" sx={{ alignItems: 'center', p: 1, gap: 1, borderBottom: '1px solid', borderColor: 'divider' }}><Typography sx={{ flex: 1, minWidth: 0, pl: 1 }}>{product.name}</Typography><Typography>{selected + 1} / {images.length}</Typography><IconButton aria-label={t(zoom ? 'Fit photo' : 'Zoom photo')} onClick={() => setZoom(!zoom)}>{zoom ? <ZoomOutOutlinedIcon /> : <ZoomInOutlinedIcon />}</IconButton><IconButton aria-label={t('Close product photos')} onClick={() => setOpen(false)}><CloseRoundedIcon /></IconButton></Stack>
      <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}><Box onTouchStart={event => { touch.current = event.touches[0].clientX }} onTouchEnd={event => { if (!zoom && touch.current !== null) { const delta = event.changedTouches[0].clientX - touch.current; if (Math.abs(delta) > 60) move(delta < 0 ? 1 : -1) } touch.current = null }} sx={{ height: '100%', overflow: 'auto', display: zoom ? 'block' : 'flex', justifyContent: 'center', alignItems: 'center' }}><Box component="img" src={images[selected].src} alt={images[selected].alt || product.name} sx={{ width: zoom ? 'auto' : '100%', height: zoom ? 'auto' : '100%', maxWidth: zoom ? 'none' : '100%', maxHeight: zoom ? 'none' : '100%', objectFit: 'contain' }} /></Box>{images.length > 1 && <><IconButton aria-label={t('Previous photo')} onClick={() => move(-1)} sx={{ position: 'absolute', top: '50%', left: 8, bgcolor: '#fff' }}><ChevronLeftRoundedIcon /></IconButton><IconButton aria-label={t('Next photo')} onClick={() => move(1)} sx={{ position: 'absolute', top: '50%', right: 8, bgcolor: '#fff' }}><ChevronRightRoundedIcon /></IconButton></>}</Box>
    </Dialog>
  </Box>
}
