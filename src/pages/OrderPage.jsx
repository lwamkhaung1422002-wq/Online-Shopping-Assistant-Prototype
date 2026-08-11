import { useParams, useNavigate } from 'react-router'
import { Button, Box, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import products from '../config/products.json'
import OrderForm from '../components/OrderForm.jsx'

export default function OrderPage() {
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

  const handleSuccess = ({ product: p, order, channel, message }) => {
    navigate('/order/success', {
      state: { product: p, order, channel, message },
    })
  }

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate(`/product/${product.id}`)}
        variant="text"
        color="primary"
        sx={{ mb: 2, pl: 0 }}
      >
        ပြန်သွားမည်
      </Button>

      <OrderForm product={product} onSuccess={handleSuccess} />
    </Box>
  )
}
