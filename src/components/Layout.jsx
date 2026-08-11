import { Box, Container, Typography, Link, alpha, Stack } from '@mui/material'
import PhoneIcon from '@mui/icons-material/Phone'
import shop from '../config/shop.json'
import BrandLogo, { LogoMark } from './BrandLogo.jsx'
import { brand, gradients } from '../theme/palette.js'

export default function Layout({ children }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Box
        component="header"
        sx={{
          background: gradients.header,
          color: brand.cream,
          py: { xs: 1.25, sm: 1.5 },
          px: 2,
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: '0 4px 24px rgba(42, 36, 50, 0.18)',
          '&::after': { content: '""', position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: gradients.goldLine, opacity: 0.85 },
        }}
      >
        <Container maxWidth="lg" disableGutters sx={{ px: { xs: 2, sm: 3 }, position: 'relative' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
            <BrandLogo />
            <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' }, color: brand.goldSoft, letterSpacing: '0.08em', fontSize: '0.75rem' }}>
              Local clothing, made easy
            </Typography>
          </Box>
        </Container>
      </Box>

      <Box component="main" sx={{ flex: 1, py: { xs: 2.5, md: 5 } }}>
        <Container maxWidth="lg" sx={{ px: { xs: 2, sm: 3 } }}>
          {children}
        </Container>
      </Box>

      <Box component="footer" sx={{ bgcolor: brand.cream, borderTop: `1px solid ${brand.sand}`, py: { xs: 3, md: 3.5 }, px: 2, mt: 'auto', backgroundImage: `linear-gradient(180deg, ${brand.sandLight} 0%, ${brand.cream} 100%)` }}>
        <Container maxWidth="lg" disableGutters sx={{ px: { xs: 2, sm: 3 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'auto 1fr' }, alignItems: 'center', gap: { xs: 2, sm: 4 } }}>
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <LogoMark size={32} />
                <Typography variant="body2" sx={{ fontFamily: '"Cormorant Garamond", serif', fontWeight: 600, fontSize: '1rem', color: brand.text }}>
                  {shop.name}
                </Typography>
              </Box>
              <Typography variant="caption" sx={{ display: 'block', mt: 1.25, color: alpha(brand.textMuted, 0.9) }}>
                © {new Date().getFullYear()} Belle Local Clothing
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.5, sm: 2 }} sx={{ alignItems: { sm: 'center' } }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, mr: { sm: 0.5 } }}>
                ဆက်သွယ်ရန်
              </Typography>
              {shop.phones.map((phone) => (
                <Box key={phone} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <PhoneIcon sx={{ fontSize: 17, color: brand.roseDeep }} />
                  <Link href={`tel:${phone}`} underline="hover" sx={{ color: brand.text, fontWeight: 500, fontSize: '0.9rem' }}>
                    {phone}
                  </Link>
                </Box>
              ))}
            </Stack>
          </Box>
        </Container>
      </Box>
    </Box>
  )
}
