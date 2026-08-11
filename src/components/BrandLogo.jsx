import { Box, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router'
import { brand } from '../theme/palette.js'

function LogoMark({ size = 40 }) {
  return (
    <Box
      component="svg"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      sx={{ flexShrink: 0, display: 'block' }}
    >
      <rect x="1" y="1" width="46" height="46" rx="14" fill={brand.cream} stroke={brand.gold} strokeWidth="1.5" />
      <path
        d="M14 34V14h8.2c4.8 0 7.8 2.5 7.8 6.5 0 2.8-1.4 4.8-3.8 5.8L32 34h-5.2l-4.8-6.8H19.2V34H14zm5.2-10.8h2.6c2 0 3.1-1 3.1-2.6 0-1.6-1.1-2.6-3.1-2.6h-2.6v5.2z"
        fill={brand.charcoal}
      />
      <path
        d="M33.5 14h5v14.2c0 3.8-2.6 6.3-6.5 6.3-3.9 0-6.5-2.5-6.5-6.3V14h5v13.5c0 1.5.9 2.4 2.2 2.4s2.2-.9 2.2-2.4V14z"
        fill={brand.roseDeep}
      />
    </Box>
  )
}

export default function BrandLogo({ compact = false, to = '/' }) {
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
      <LogoMark size={compact ? 36 : 42} />
      <Box sx={{ lineHeight: 1.15 }}>
        <Typography
          sx={{
            fontFamily: '"Cormorant Garamond", Georgia, serif',
            fontWeight: 600,
            fontSize: compact ? '1.15rem' : '1.35rem',
            letterSpacing: '0.02em',
            color: brand.cream,
          }}
        >
          Belle Local
        </Typography>
        {!compact && (
          <Typography
            sx={{
              fontFamily: '"Noto Sans Myanmar", sans-serif',
              fontSize: '0.65rem',
              fontWeight: 500,
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              color: brand.goldSoft,
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
