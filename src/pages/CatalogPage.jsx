import { Typography, Box, Paper, Chip } from '@mui/material'
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
          p: { xs: 2.5, sm: 4, lg: 5 },
          mb: { xs: 3, md: 4 },
          borderRadius: { xs: 3, md: 5 },
          border: `1px solid ${brand.sand}`,
          background: `radial-gradient(circle at 87% 18%, rgba(196, 165, 116, 0.22), transparent 22%), ${gradients.hero}`,
          boxShadow: '0 14px 42px rgba(42, 36, 50, 0.07)',
        }}
      >
        <Box sx={{ maxWidth: 740 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <AutoAwesomeIcon sx={{ fontSize: 20, color: brand.gold }} />
            <Typography variant="h1" sx={{ mb: 0 }}>
              Collection
            </Typography>
          </Box>
          <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.8, maxWidth: 640 }}>
            ပုံရွေးချယ်၊ size/form ဖြည့်ပြီး Telegram / TikTok / Messenger မှ တိုက်ရိုက် order တင်ပါ။ မြန်ဆန်၊ လွယ်ကူ — OS reply စောင့်ချိန် လျှော့ချနိုင်ပါတယ်။
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2.5 }}>
            <Chip label="Size guide ပါဝင်သည်" size="small" />
            <Chip label="Order form လွယ်ကူ" size="small" />
            <Chip label="Chat မှ တိုက်ရိုက်မှာယူ" size="small" />
          </Box>
        </Box>
      </Paper>

      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h2">New arrivals</Typography>
        <Typography variant="body2" color="text.secondary">{products.length} styles</Typography>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: { xs: 2, md: 2.5 } }}>
        {sorted.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </Box>
    </Box>
  )
}
