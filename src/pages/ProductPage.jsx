import { useParams, useNavigate } from 'react-router'
import { Typography, Button, Box } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ShoppingBagIcon from '@mui/icons-material/ShoppingBag'
import WhatshotIcon from '@mui/icons-material/Whatshot'
import products from '../config/products.json'
import AlbumGallery from '../components/AlbumGallery.jsx'
import SizeDescription from '../components/SizeDescription.jsx'
import { brand } from '../theme/palette.js'

export default function ProductPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const product = products.find((p) => p.id === id)

  if (!product) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography>Product မတွေ့ပါ</Typography>
        <Button onClick={() => navigate('/')} sx={{ mt: 2 }}>ပြန်သွားမည်</Button>
      </Box>
    )
  }

  return (
    <Box sx={{ maxWidth: 1120, mx: 'auto' }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/')} variant="text" color="primary" sx={{ mb: { xs: 2, md: 3 }, pl: 0 }}>
        ပြန်သွားမည်
      </Button>

      {product.featured && (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 1.5, px: 1.25, py: 0.5, borderRadius: 2, bgcolor: brand.sandLight, border: `1px solid ${brand.goldSoft}` }}>
          <WhatshotIcon sx={{ fontSize: 18, color: brand.gold }} />
          <Typography variant="body2" fontWeight={600} sx={{ color: brand.plum }}>ရေပန်းအစားဆုံး</Typography>
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.3fr) minmax(320px, 0.7fr)' }, gap: { xs: 3, md: 5 }, alignItems: 'start' }}>
        <AlbumGallery product={product} />
        <Box sx={{ position: { md: 'sticky' }, top: { md: 104 } }}>
          <Typography variant="h1" gutterBottom>{product.name}</Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3, lineHeight: 1.8 }}>{product.description}</Typography>
          <SizeDescription productId={product.id} />
          <Button variant="contained" fullWidth size="large" startIcon={<ShoppingBagIcon />} onClick={() => navigate(`/product/${product.id}/order`)} sx={{ mt: 1.5, minHeight: 52 }}>
            Order တင်မည်
          </Button>
        </Box>
      </Box>
    </Box>
  )
}
