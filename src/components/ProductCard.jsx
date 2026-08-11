import { Card, CardActionArea, CardContent, Typography, Box, Chip } from '@mui/material'
import WhatshotIcon from '@mui/icons-material/Whatshot'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { Link as RouterLink } from 'react-router'
import { brand } from '../theme/palette.js'
import { getProductImages } from '../config/productImages.js'

export default function ProductCard({ product }) {
  const productImages = getProductImages(product.id)
  const firstImage = productImages?.[0] ?? product.album[0]
  const colors = productImages ? [...new Set(productImages.map((item) => item.color))].join(' · ') : null

  return (
    <Card sx={{ height: '100%', mb: 0 }}>
      <CardActionArea component={RouterLink} to={`/product/${product.id}`}>
        <Box
          sx={{
            height: { xs: 220, sm: 250, lg: 270 },
            background: firstImage?.gradient ?? brand.sand,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            '&::after': {
              content: '""',
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg, transparent 40%, rgba(42,36,50,0.35) 100%)',
            },
          }}
        >
          {firstImage?.src && (
            <Box
              component="img"
              src={firstImage.src}
              alt={`${product.name} — ${firstImage.color}`}
              sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
          {!firstImage?.src && (
            <Typography
              variant="body2"
              sx={{
                color: 'rgba(255,252,247,0.85)',
                fontSize: '0.7rem',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                zIndex: 1,
              }}
            >
              Preview
            </Typography>
          )}
          {product.featured && (
            <Chip
              icon={<WhatshotIcon sx={{ fontSize: '16px !important' }} />}
              label="ရေပန်းအစားဆုံး"
              size="small"
              sx={{
                position: 'absolute',
                top: 14,
                left: 14,
                zIndex: 1,
                background: `linear-gradient(135deg, ${brand.gold} 0%, ${brand.goldSoft} 100%)`,
                color: brand.charcoal,
                fontWeight: 700,
                border: 'none',
                '& .MuiChip-icon': { color: brand.charcoal },
              }}
            />
          )}
        </Box>
        <CardContent sx={{ py: 2.25, px: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Typography variant="h3" sx={{ mb: 0.5 }}>
              {product.name}
            </Typography>
            <ArrowForwardIcon sx={{ fontSize: 18, color: brand.rose, opacity: 0.9 }} />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {product.description}
          </Typography>
          {colors && (
            <Typography variant="caption" sx={{ display: 'block', mt: 1.25, color: brand.roseDeep, fontWeight: 700, letterSpacing: '0.04em' }}>
              Colors: {colors}
            </Typography>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
