import { Box, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router'
export function LogoMark({ size = 44 }) {
  return <Box component="img" src={import.meta.env.BASE_URL + 'brand/belle-local-logo.png'} alt="" aria-hidden sx={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, bgcolor: '#24201f', borderRadius: '2px' }} />
}
export default function BrandLogo({ compact = false, to = '/', name = 'Belle Local Clothing' }) {
  return <Box component={RouterLink} to={to} aria-label={name + ' home'} sx={{ display: 'inline-flex', alignItems: 'center', gap: { xs: 1, md: 1.4 }, textDecoration: 'none', flexShrink: 0, minWidth: 0 }}>
    <LogoMark size={compact ? { xs: 34, md: 44 } : 48} /><Typography component="span" sx={{ fontFamily: 'Georgia,"Times New Roman",serif', fontSize: { xs: 'clamp(15px,4.35vw,20px)', md: 24 }, lineHeight: 1.2, fontWeight: 400, letterSpacing: '.008em', whiteSpace: 'nowrap' }}>{name}</Typography>
  </Box>
}
