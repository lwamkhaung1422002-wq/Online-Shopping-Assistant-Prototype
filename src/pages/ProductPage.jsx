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
        <Button onClick={() => navigate('/')} sx={{ mt: 2 }}>
          ပြန်သွားမည်
        </Button>
      </Box>
    )
  }

  return (
    <Box>
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate('/')}
        variant="text"
        color="primary"
        sx={{ mb: 2, pl: 0 }}
      >
        ပြန်သွားမည်
      </Button>

      {product.featured && (
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            mb: 1,
            px: 1.25,
            py: 0.5,
            borderRadius: 2,
            bgcolor: brand.sandLight,
            border: `1px solid ${brand.goldSoft}`,
          }}
        >
          <WhatshotIcon sx={{ fontSize: 18, color: brand.gold }} />
          <Typography variant="body2" fontWeight={600} sx={{ color: brand.plum }}>
            ရေပန်းအစားဆုံး
          </Typography>
        </Box>
      )}

      <Typography variant="h1" gutterBottom>
        {product.name}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        {product.description}
      </Typography>

      <AlbumGallery product={product} />

      <Box sx={{ mt: 3 }}>
        <SizeDescription productId={product.id} />
      </Box>

      <Button
        variant="contained"
        fullWidth
        size="large"
        startIcon={<ShoppingBagIcon />}
        onClick={() => navigate(`/product/${product.id}/order`)}
        sx={{ mt: 1 }}
      >
        Order တင်မည်
      </Button>
    </Box>
  )
}
