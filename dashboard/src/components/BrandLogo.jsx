import { Box, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router'
export function LogoMark({ size = 44 }) {
  return <Box component="img" src={import.meta.env.BASE_URL + 'brand/belle-local-logo.png'} alt="" aria-hidden sx={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, bgcolor: '#24201f', borderRadius: '2px' }} />
}
export default function BrandLogo({ compact = false, to = '/', name = 'Belle Local Clothing' }) {
  return <Box component={RouterLink} to={to} aria-label={name + ' home'} sx={{ display: 'inline-flex', alignItems: 'center', gap: { xs: .8, md: 1.4 }, textDecoration: 'none', minWidth: 0 }}>
    <LogoMark size={compact ? { xs: 30, md: 44 } : 48} /><Typography component="span" sx={{ fontFamily: 'Georgia,"Times New Roman",serif', fontSize: { xs: 'clamp(13px,3.5vw,18px)', md: 24 }, lineHeight: 1.2, fontWeight: 400, letterSpacing: '.008em', minWidth: 0, overflowWrap: 'normal' }}>{name}</Typography>
  </Box>
}
