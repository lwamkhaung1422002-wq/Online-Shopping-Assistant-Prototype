import { useState } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router'
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material'
import { useStore } from '../services/store-context.js'
import { useStorefrontUi } from '../services/storefront-ui.js'
import AlbumGallery from '../components/AlbumGallery.jsx'
import ProductSelection from '../components/ProductSelection.jsx'
export default function ProductPage({ embedded = false }) {
  const { id } = useParams(), navigate = useNavigate()
  const location = useLocation()
  const { products, loading, error } = useStore()
  const { overlayState } = useStorefrontUi()
  const [galleryColor, setGalleryColor] = useState(null)
  if (loading) return <CircularProgress aria-label="Loading product" />
  if (error) return <Alert severity="error">Unable to load this product.</Alert>
  const product = products.find(p => p.id === id || p.slug === id)
  if (!product) return <Box><Typography>Product not found.</Typography><Button component={Link} to="/">Browse collection</Button></Box>
  const initialColor = location.state?.productColor || (product.images?.find(image => image.is_cover) || product.images?.[0])?.color
  return <Box>
    {!embedded && <Button component={Link} to="/" sx={{ mb: 2 }}>Back to collection</Button>}
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,1.08fr) minmax(0,1fr)' } }}>
      <AlbumGallery key={galleryColor || initialColor || 'cover'} product={product} color={galleryColor || initialColor} />
      <Box sx={{ minWidth: 0, p: { xs: '19px 19px 30px', md: '54px 35px 35px' } }}>
        <Typography sx={{ fontSize: 10, letterSpacing: '.19em', color: 'primary.main', fontWeight: 700, textTransform: 'uppercase' }}>Belle Local Clothing{product.category?.name ? ' / ' + product.category.name : ''}</Typography>
        <Typography component="h1" sx={{ fontFamily: 'Georgia,serif', fontSize: { xs: 27, md: 36 }, fontWeight: 400, lineHeight: 1.18, letterSpacing: '-.03em', mt: '13px', mb: '12px' }}>{product.name}</Typography>
        <ProductSelection key={product.id} product={product} initialColor={initialColor} onColorChange={setGalleryColor} onAdded={embedded ? () => navigate('/cart', { state: overlayState }) : undefined} />
      </Box>
    </Box>
  </Box>
}
