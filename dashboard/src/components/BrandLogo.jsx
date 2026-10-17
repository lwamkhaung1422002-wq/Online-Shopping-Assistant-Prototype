import { Box, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router'
import { brand } from '../theme/palette.js'

function LogoMark({ size = 64 }) {
  return (
    <Box
      component="img"
      src={`${import.meta.env.BASE_URL}brand/belle-local-logo.png`}
      alt=""
      width={size}
      height={size}
      aria-hidden
      sx={{ flexShrink: 0, display: 'block', objectFit: 'contain', aspectRatio: '1 / 1' }}
    />
  )
}

export default function BrandLogo({ compact = false, to = '/', name = 'Belle Local' }) {
  return (
    <Box
      component={RouterLink}
      to={to}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 1 : 1.25,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <LogoMark size={compact ? 64 : 80} />
      <Box sx={{ lineHeight: 1.15 }}>
        <Typography
          sx={{
            fontFamily: '"Cormorant Garamond", Georgia, serif',
            fontWeight: 600,
            fontSize: compact ? '1.15rem' : '1.35rem',
            letterSpacing: '0.02em',
            color: brand.text,
          }}
        >
          {name}
        </Typography>
        {!compact && (
          <Typography
            sx={{
              fontFamily: '"Noto Sans Myanmar", sans-serif',
              fontSize: '0.65rem',
              fontWeight: 500,
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              color: brand.textMuted,
              mt: 0.25,
            }}
          >
            Clothing
          </Typography>
        )}
      </Box>
    </Box>
  )
}

export { LogoMark }
