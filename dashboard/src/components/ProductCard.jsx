import { useStoreLanguage } from '../services/language.js'
import { Box, Button, ButtonBase, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import { Link as RouterLink } from 'react-router'
import { useStorefrontUi } from '../services/storefront-ui.js'
import { money, productStock } from '../../shared/catalog.js'
import { productOffer } from '../../shared/product-offer.js'

export default function ProductCard({ product }) {
  const { t } = useStoreLanguage()
  const { overlayState } = useStorefrontUi()
  const images = product.images || [], initial = images.find(image => image.is_cover) || images[0]
  const colors = [...new Set(product.variants.filter(variant => variant.active && variant.color).map(variant => variant.color))]
  const selectedColor = colors.includes(initial?.color) ? initial.color : colors[0]
  const photo = initial
  const offer = productOffer(product, selectedColor)
  const stock = productStock(product), to = '/product/' + product.id, cardState = { ...overlayState, productColor: selectedColor }
  return <Box component="article" sx={{ minWidth: 0, '&:hover .store-product-photo': { transform: 'scale(1.04)' }, '&:hover .store-quick-add': { transform: 'translateY(0)' } }}>
    <Box sx={{ position: 'relative', overflow: 'hidden', bgcolor: '#f0ece7', aspectRatio: { xs: '3 / 4.25', md: '3 / 4' } }}>
      <ButtonBase component={RouterLink} to={to} state={cardState} aria-label={t('View {name}', { name: product.name })} sx={{ width: '100%', height: '100%' }}>{photo?.src && <Box component="img" className="store-product-photo" src={photo.src} loading="lazy" alt={photo.alt || product.name + (photo.color ? ' — ' + photo.color : '')} sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: { xs: 'center 20%', md: 'center 24%' }, transition: 'transform .5s ease', filter: { md: 'saturate(.91)' } }} />}</ButtonBase>
      {(!stock || offer.saving > 0) && <Box component="span" sx={{ position: 'absolute', top: { xs: 8, md: 13 }, left: { xs: 8, md: 12 }, px: { xs: 1, md: 1.4 }, py: .75, bgcolor: !stock ? 'rgba(42,35,33,.88)' : offer.saving ? 'primary.main' : 'rgba(255,255,255,.95)', color: !stock || offer.saving ? '#fff' : '#393331', fontSize: { xs: 10, md: 11 }, fontWeight: 700, letterSpacing: '.035em', textTransform: 'uppercase', pointerEvents: 'none' }}>{!stock ? t('Sold out') : offer.saving ? `${offer.percent || money(offer.saving)}${offer.percent ? '%' : ''} ${t('OFF')}` : ''}</Box>}
      {stock > 0 && <Button className="store-quick-add" component={RouterLink} to={to} state={cardState} startIcon={<AddRoundedIcon />} sx={{ display: { xs: 'none', md: 'flex' }, position: 'absolute', bottom: 12, left: 12, right: 12, minHeight: 42, height: 42, p: 1, fontSize: 12, fontWeight: 700, bgcolor: 'rgba(255,255,255,.96)', color: '#352b28', transform: 'translateY(130%)', transition: 'transform .25s', '&:focus-visible': { transform: 'translateY(0)' }, '&:hover': { bgcolor: '#fff' }, '& .MuiSvgIcon-root': { fontSize: 15 } }}>{t('QUICK ADD')}</Button>}
    </Box>
    <Box sx={{ pt: { xs: '9px', md: '11px' } }}><ButtonBase component={RouterLink} to={to} state={cardState} sx={{ display: 'block', textAlign: 'left', width: '100%' }}><Typography component="h2" sx={{ fontFamily: 'Georgia,serif', fontSize: { xs: 13.5, md: 17 }, lineHeight: { xs: 1.3, md: 1.35 }, fontWeight: 400, mb: '5px', overflowWrap: 'anywhere' }}>{product.name}</Typography><Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: .75 }}><Typography component="span" sx={{ fontSize: { xs: 12, md: 13 }, fontWeight: 650, color: offer.saving ? 'primary.main' : 'text.primary' }}>{money(offer.price)}</Typography>{offer.saving > 0 && <Typography component="del" aria-label={t('Original price')} sx={{ fontSize: { xs: 10.5, md: 12 }, color: 'text.secondary', textDecorationThickness: '1px' }}>{money(offer.originalPrice)}</Typography>}</Box></ButtonBase>
    </Box>
  </Box>
}
