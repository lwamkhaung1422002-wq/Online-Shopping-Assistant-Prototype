import { Box, Typography } from '@mui/material'
import { brand } from '../theme/palette.js'

export default function AlbumGallery({ product }) {
  const album = product.images || []

  return (
    <Box
      sx={{
        display: { xs: 'flex', md: 'grid' },
        gridTemplateColumns: { md: 'repeat(2, minmax(0, 1fr))' },
        gap: 1.5,
        overflowX: { xs: 'auto', md: 'visible' },
        pb: 1,
        mx: -0.5,
        px: 0.5,
        scrollSnapType: 'x mandatory',
        '&::-webkit-scrollbar': { display: 'none' },
      }}
    >
      {album.map((item) => (
        <Box
          key={item.id}
          sx={{
            minWidth: { xs: 268, md: 0 },
            height: { xs: 340, md: 360 },
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
          {item.src && (
            <Box
              component="img"
              src={item.src}
              alt={item.alt || `${product.name}${item.color ? ` — ${item.color}` : ''}`}
              sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
          <Typography
            variant="h3"
            sx={{ color: brand.cream, fontWeight: 600, mb: 0.25, zIndex: 1, textShadow: '0 2px 12px rgba(0,0,0,0.3)' }}
          >
            {item.color ?? product.name}
          </Typography>
          <Typography variant="body2" sx={{ color: brand.goldSoft, zIndex: 1, letterSpacing: '0.15em', fontSize: '0.75rem' }}>
            {item.color ? product.name : `LOOK ${item.id}`}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}
