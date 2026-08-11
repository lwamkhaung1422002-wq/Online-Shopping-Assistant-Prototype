import { Box, Typography } from '@mui/material'
import { brand } from '../theme/palette.js'

export default function AlbumGallery({ product }) {
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.5,
        overflowX: 'auto',
        pb: 1,
        mx: -0.5,
        px: 0.5,
        scrollSnapType: 'x mandatory',
        '&::-webkit-scrollbar': { display: 'none' },
      }}
    >
      {product.album.map((item) => (
        <Box
          key={item.id}
          sx={{
            minWidth: 268,
            height: 340,
            borderRadius: 3,
            background: item.gradient,
            border: `1px solid ${brand.sand}`,
            boxShadow: '0 12px 40px rgba(42, 36, 50, 0.12)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-end',
            scrollSnapAlign: 'start',
            flexShrink: 0,
            pb: 3,
            position: 'relative',
            overflow: 'hidden',
            '&::before': {
              content: '""',
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg, transparent 50%, rgba(42,36,50,0.45) 100%)',
            },
          }}
        >
          <Typography
            variant="h3"
            sx={{ color: brand.cream, fontWeight: 600, mb: 0.25, zIndex: 1, textShadow: '0 2px 12px rgba(0,0,0,0.3)' }}
          >
            {product.name}
          </Typography>
          <Typography variant="body2" sx={{ color: brand.goldSoft, zIndex: 1, letterSpacing: '0.15em', fontSize: '0.75rem' }}>
            LOOK {item.id}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}
