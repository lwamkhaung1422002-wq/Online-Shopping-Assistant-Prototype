import { useState } from 'react'
import { Badge, Box, Button, IconButton, Stack, Typography } from '@mui/material'
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined'
import CheckroomRoundedIcon from '@mui/icons-material/CheckroomRounded'
import ShoppingBagRoundedIcon from '@mui/icons-material/ShoppingBagRounded'
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined'
import CallOutlinedIcon from '@mui/icons-material/CallOutlined'
import TelegramIcon from '@mui/icons-material/Telegram'
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded'
import MusicNoteRoundedIcon from '@mui/icons-material/MusicNoteRounded'
import { Link as RouterLink, useLocation } from 'react-router'
import BrandLogo from './BrandLogo.jsx'
import { brand, storefrontWidth } from '../theme/palette.js'
import { useStore } from '../services/store-context.js'
import { useCart } from '../services/cart-context.js'
import { StorefrontUiContext } from '../services/storefront-ui.js'
export default function Layout({ children }) {
  const { settings } = useStore(), { count } = useCart(), location = useLocation()
  const [searchOpen, setSearchOpen] = useState(false), [year] = useState(() => new Date().getFullYear())
  const backgroundLocation = location.state?.backgroundLocation || (location.pathname === '/' ? location : { pathname: '/' })
  const overlayState = { backgroundLocation }
  const contacts = [
    settings?.phone && [settings.phone, 'tel:' + settings.phone, <CallOutlinedIcon key="phone" />],
    settings?.telegram && ['Telegram', 'https://t.me/' + settings.telegram, <TelegramIcon key="telegram" />],
    settings?.messenger && ['Messenger', 'https://m.me/' + settings.messenger, <ChatBubbleOutlineRoundedIcon key="messenger" />],
    settings?.tiktok && ['TikTok', 'https://www.tiktok.com/@' + settings.tiktok, <MusicNoteRoundedIcon key="tiktok" />],
  ].filter(Boolean)
  const links = [['Shop', '/', <CheckroomRoundedIcon key="shop" />], ['Track order', '/track', <LocalShippingOutlinedIcon key="track" />], ['Cart', '/cart', <ShoppingBagRoundedIcon key="cart" />]]
  return <StorefrontUiContext.Provider value={{ searchOpen, closeSearch: () => setSearchOpen(false), overlayState }}>
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ height: { xs: 3, md: 7 }, bgcolor: 'primary.main' }} />
      {settings?.announcement && <Typography align="center" sx={{ py: 1, bgcolor: brand.warm, px: 2, fontSize: 12 }}>{settings.announcement}</Typography>}
      <Box component="header" sx={{ height: { xs: 60, md: 72 }, position: 'sticky', top: 0, bgcolor: '#fff', zIndex: 30, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" sx={{ ...storefrontWidth, height: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <BrandLogo compact name="Belle Local Clothing" />
          <Stack component="nav" aria-label="Store navigation" direction="row" sx={{ alignItems: 'center', gap: .5 }}>
            {links.map(([label, to, icon]) => <Button key={to} component={RouterLink} to={to} state={to === '/' ? undefined : overlayState} startIcon={to === '/' ? undefined : icon} aria-label={label === 'Cart' ? 'Cart (' + count + ')' : label} sx={{ display: { xs: 'none', md: 'inline-flex' }, position: 'relative', px: 2.25, py: 1.25, minHeight: 44, color: to === '/' ? 'primary.main' : 'text.primary', ...(to === '/' ? { '&:after': { content: '""', position: 'absolute', left: 18, right: 18, bottom: 4, height: 2, bgcolor: 'primary.main' } } : {}), '& .MuiButton-startIcon .MuiSvgIcon-root': { fontSize: 18 } }}>{label}{label === 'Cart' && <Box component="span" sx={{ ml: 1, minWidth: 20, height: 20, px: .6, display: 'inline-grid', placeItems: 'center', borderRadius: '50px', color: '#fff', bgcolor: 'primary.main', fontSize: 11 }}>{count}</Box>}</Button>)}
            <IconButton aria-label="Search products" aria-controls="storefront-search-panel" aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)} sx={{ ml: { xs: 0, md: 1 }, borderLeft: { md: '1px solid #e8e5e1' }, borderRadius: { xs: '50%', md: 0 }, bgcolor: { xs: '#f8f6f4', md: 'transparent' }, width: { xs: 44, md: 56 }, height: 44, color: 'text.primary' }}><SearchOutlinedIcon sx={{ fontSize: 22 }} /></IconButton>
          </Stack>
        </Stack>
      </Box>
      <Box id="storefront-search-slot" sx={{ position: 'sticky', top: { xs: 60, md: 72 }, zIndex: 29 }} />
      <Box component="main" sx={{ ...storefrontWidth, flex: 1, pt: { xs: '14px', md: '22px' }, pb: { xs: 4, md: 7 } }}>{children}</Box>
      <Box component="footer" sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: '#faf8f6', py: 2.5, pb: { xs: 'calc(96px + env(safe-area-inset-bottom,0px))', md: 2.5 } }}><Stack direction={{ xs: 'column', sm: 'row' }} sx={{ ...storefrontWidth, alignItems: 'center', justifyContent: 'space-between', gap: 1.25 }}><Typography sx={{ fontSize: 12, color: 'text.secondary', letterSpacing: '.02em' }}>© {year} Belle Local Clothing</Typography><Stack direction="row" sx={{ flexWrap: 'wrap', justifyContent: 'center', gap: 1 }}>{contacts.map(([label, url, icon]) => <Button key={url} component="a" href={url} target={url.startsWith('tel:') ? undefined : '_blank'} rel="noopener noreferrer" startIcon={icon} sx={{ minHeight: 36, px: 1.25, borderRadius: 1, fontSize: 12, color: 'primary.main', '& .MuiSvgIcon-root': { fontSize: 17 } }}>{label}</Button>)}</Stack></Stack></Box>
      <Box component="nav" aria-label="Mobile store navigation" sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, display: { xs: 'grid', md: 'none' }, gridTemplateColumns: 'repeat(3,minmax(0,1fr))', bgcolor: 'rgba(255,255,255,.97)', backdropFilter: 'blur(16px)', borderTop: '1px solid #e9e4df', boxShadow: '0 -4px 20px rgba(50,41,35,.04)', zIndex: 45, p: '5px 10px calc(5px + env(safe-area-inset-bottom,0px))' }}>
        {links.map(([label, to, icon]) => { const active = location.pathname === to; return <Button key={to} component={RouterLink} to={to} state={to === '/' ? undefined : overlayState} aria-label={label === 'Cart' ? 'Cart (' + count + ')' : label} aria-current={active ? 'page' : undefined} onClick={() => setSearchOpen(false)} sx={{ minWidth: 0, minHeight: 60, p: .5, display: 'flex', flexDirection: 'column', gap: .35, fontSize: 11, fontWeight: active ? 650 : 500, color: active ? 'primary.main' : 'text.secondary' }}><Box component="span" sx={{ display: 'grid', placeItems: 'center', height: 30, width: 56, borderRadius: 2, bgcolor: active ? '#f1e7e1' : 'transparent', '& .MuiSvgIcon-root': { fontSize: 23 } }}>{label === 'Cart' ? <Badge badgeContent={count} color="primary" max={99}>{icon}</Badge> : icon}</Box><Box component="span">{label}</Box></Button> })}
      </Box>
    </Box>
  </StorefrontUiContext.Provider>
}
