import { useParams, Link } from 'react-router'
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material'
import { useStore } from '../services/store-context.js'
import AlbumGallery from '../components/AlbumGallery.jsx'
import SizeDescription from '../components/SizeDescription.jsx'
import ProductSelection from '../components/ProductSelection.jsx'
export default function ProductPage() {
  const { id } = useParams()
  const { products, loading, error, configured } = useStore()
  if (loading) return <CircularProgress aria-label="Loading product" />
  if (error) return <Alert severity="error">Unable to load this product.</Alert>
  const product = products.find((p) => p.id === id || p.slug === id)
  if (!product) return <Box><Typography>Product not found.</Typography><Button component={Link} to="/">Browse collection</Button></Box>
  return <Box><Button component={Link} to="/" sx={{ mb: 2 }}>Back to collection</Button>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0,1.2fr) minmax(320px,0.8fr)' }, gap: 4 }}>
      <AlbumGallery product={product} /><Box><Typography variant="h1" gutterBottom>{product.name}</Typography><Typography color="text.secondary">{product.description}</Typography>
        <SizeDescription guide={product.guide} /><ProductSelection key={product.id} product={product} />
        {!configured && <Alert severity="info" sx={{ mt: 2 }}>Preview · Contact the shop for availability.</Alert>}
      </Box>
    </Box>
  </Box>
}
