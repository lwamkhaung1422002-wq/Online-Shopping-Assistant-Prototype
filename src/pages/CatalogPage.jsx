import { Typography, Box, Paper } from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import products from '../config/products.json'
import ProductCard from '../components/ProductCard.jsx'
import { brand, gradients } from '../theme/palette.js'

export default function CatalogPage() {
  const sorted = [...products].sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0))

  return (
    <Box>
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          mb: 3,
          borderRadius: 3,
          border: `1px solid ${brand.sand}`,
          background: gradients.hero,
          boxShadow: '0 8px 32px rgba(42, 36, 50, 0.06)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <AutoAwesomeIcon sx={{ fontSize: 20, color: brand.gold }} />
          <Typography variant="h1" sx={{ fontSize: '1.85rem', mb: 0 }}>
            Collection
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.75 }}>
          ပုံရွေးချယ်၊ size/form ဖြည့်ပြီး Telegram / TikTok / Messenger မှ တိုက်ရိုက် order တင်ပါ။
          မြန်ဆန်၊ လွယ်ကူ — OS reply စောင့်ချိန် လျှော့ချနိုင်ပါတယ်။
        </Typography>
      </Paper>

      {sorted.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </Box>
  )
}
