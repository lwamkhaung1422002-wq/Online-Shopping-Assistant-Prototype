import { Box, Container, Typography, Link, alpha } from '@mui/material'
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
          py: 1.75,
          px: 2,
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: '0 4px 24px rgba(42, 36, 50, 0.18)',
          '&::after': {
            content: '""',
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 2,
            background: gradients.goldLine,
            opacity: 0.85,
          },
        }}
      >
        <Container maxWidth="sm" disableGutters sx={{ px: 2, position: 'relative' }}>
          <BrandLogo compact />
        </Container>
      </Box>

      <Box component="main" sx={{ flex: 1, py: 2.5 }}>
        <Container maxWidth="sm" sx={{ px: 2 }}>
          {children}
        </Container>
      </Box>

      <Box
        component="footer"
        sx={{
          bgcolor: brand.cream,
          borderTop: `1px solid ${brand.sand}`,
          py: 3,
          px: 2,
          mt: 'auto',
          backgroundImage: `linear-gradient(180deg, ${brand.sandLight} 0%, ${brand.cream} 100%)`,
        }}
      >
        <Container maxWidth="sm" disableGutters sx={{ px: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <LogoMark size={32} />
            <Typography
              variant="body2"
              sx={{
                fontFamily: '"Cormorant Garamond", serif',
                fontWeight: 600,
                fontSize: '1rem',
                color: brand.text,
              }}
            >
              {shop.name}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" gutterBottom sx={{ fontWeight: 500 }}>
            ဆက်သွယ်ရန်
          </Typography>
          {shop.phones.map((phone) => (
            <Box key={phone} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
              <PhoneIcon sx={{ fontSize: 17, color: brand.roseDeep }} />
              <Link
                href={`tel:${phone}`}
                underline="hover"
                sx={{ color: brand.text, fontWeight: 500, fontSize: '0.9rem' }}
              >
                {phone}
              </Link>
            </Box>
          ))}
          <Typography variant="caption" sx={{ display: 'block', mt: 2, color: alpha(brand.textMuted, 0.9) }}>
            © {new Date().getFullYear()} Belle Local Clothing
          </Typography>
        </Container>
      </Box>
    </Box>
  )
}
