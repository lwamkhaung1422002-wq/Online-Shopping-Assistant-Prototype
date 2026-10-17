import { Box, Button, Container, Link, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router'
import BrandLogo from './BrandLogo.jsx'
import { brand } from '../theme/palette.js'
import { useStore } from '../services/store-context.js'
import { useCart } from '../services/cart-context.js'
export default function Layout({ children }) {
  const { settings } = useStore(); const { count } = useCart()
  const contacts = [
    settings?.telegram && ['Telegram', 'https://t.me/' + settings.telegram],
    settings?.messenger && ['Messenger', 'https://m.me/' + settings.messenger],
    settings?.tiktok && ['TikTok', 'https://www.tiktok.com/@' + settings.tiktok],
  ].filter(Boolean)
  return <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
    {settings?.announcement && <Typography align="center" variant="body2" sx={{ py: 1, bgcolor: brand.sandLight, px: 2 }}>{settings.announcement}</Typography>}
    <Box component="header" sx={{ bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', position: 'sticky', top: 0, zIndex: 100, py: 1.5 }}>
      <Container maxWidth="lg"><Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <BrandLogo compact name={settings?.store_name || 'Belle Local'} />
        <Stack component="nav" aria-label="Store navigation" direction="row" sx={{ flexWrap: 'wrap', gap: .5, minWidth: 0, '& .MuiButton-root': { px: { xs: 1.5, sm: 2 }, py: 1, whiteSpace: 'nowrap', flexShrink: 0 } }}><Button component={RouterLink} to="/">Shop</Button><Button component={RouterLink} to="/track">Track order</Button><Button component={RouterLink} to="/cart">Cart ({count})</Button></Stack>
      </Stack></Container>
    </Box>
    <Container component="main" maxWidth="lg" sx={{ flex: 1, py: { xs: 3, md: 5 } }}>{children}</Container>
    <Box component="footer" sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', py: 3 }}><Container maxWidth="lg"><Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: "space-between", gap: 2 }}>
      <Typography variant="body2">© {new Date().getFullYear()} {settings?.store_name || 'Belle Local'}</Typography>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 2 }}>{settings?.phone && <Link href={'tel:' + settings.phone}>Call the shop</Link>}{contacts.map(([label, url]) => <Link key={label} href={url} target="_blank" rel="noopener noreferrer">{label}</Link>)}</Stack>
    </Stack></Container></Box>
  </Box>
}
