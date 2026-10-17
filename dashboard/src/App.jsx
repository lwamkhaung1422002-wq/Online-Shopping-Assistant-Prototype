import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router'
import { ThemeProvider, CssBaseline, Dialog, DialogContent, Drawer, IconButton, Alert, useMediaQuery } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import theme from './theme/theme.js'
import Layout from './components/Layout.jsx'
import CatalogPage from './pages/CatalogPage.jsx'
import ProductPage from './pages/ProductPage.jsx'
import OrderPage from './pages/OrderPage.jsx'
import CartPage from './pages/CartPage.jsx'
import CheckoutPage from './pages/CheckoutPage.jsx'
import TrackingPage from './pages/TrackingPage.jsx'

function StoreModal({ children, product = false, label }) {
  const navigate = useNavigate(), location = useLocation(), mobile = useMediaQuery('(max-width:760px)')
  const close = () => navigate(location.state.backgroundLocation, { replace: true })
  return <Dialog open onClose={close} fullScreen={product && mobile} maxWidth={false} slotProps={{ paper: { 'aria-label': label, sx: { m: product && mobile ? 0 : { xs: 2, md: 0 }, width: product ? { xs: '100%', md: 920 } : { xs: 'calc(100% - 32px)', md: 490 }, maxWidth: '100%', maxHeight: product && mobile ? '100dvh' : '92dvh', borderRadius: 0, position: 'relative', overflow: 'visible' } } }}>
    <IconButton aria-label={'Close ' + label} onClick={close} sx={{ position: 'absolute', top: 15, right: 15, zIndex: 2, width: 38, height: 38, bgcolor: '#fff', boxShadow: '0 3px 12px #1914141b', '&:hover': { bgcolor: '#eee' } }}><CloseRoundedIcon /></IconButton>
    <DialogContent sx={{ p: product ? 0 : { xs: '30px 20px', md: '40px' }, overflowY: 'auto', minWidth: 0 }}>{children}</DialogContent>
  </Dialog>
}
function StoreRoutes() {
  const location = useLocation(), navigate = useNavigate(), background = location.state?.backgroundLocation
  const close = () => navigate(background, { replace: true })
  return <Layout>
    <Routes location={background || location}>
      <Route path="/" element={<CatalogPage />} />
      <Route path="/product/:id" element={<ProductPage />} />
      <Route path="/product/:id/order" element={<OrderPage />} />
      <Route path="/cart" element={<CartPage />} />
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/track" element={<TrackingPage />} />
      <Route path="/order/success" element={<TrackingPage confirmation />} />
      <Route path="*" element={<Alert severity="warning">Page not found.</Alert>} />
    </Routes>
    {background && <Routes>
      <Route path="/product/:id" element={<StoreModal product label="product details"><ProductPage embedded /></StoreModal>} />
      <Route path="/cart" element={<Drawer anchor="right" open onClose={close} slotProps={{ paper: { role: 'dialog', 'aria-modal': true, 'aria-label': 'Shopping cart', sx: { width: 440, maxWidth: '100%', height: '100dvh' } } }}><CartPage embedded onClose={close} /></Drawer>} />
      <Route path="/checkout" element={<StoreModal label="checkout"><CheckoutPage embedded /></StoreModal>} />
      <Route path="/track" element={<StoreModal label="order tracking"><TrackingPage /></StoreModal>} />
      <Route path="/order/success" element={<StoreModal label="order confirmation"><TrackingPage confirmation /></StoreModal>} />
    </Routes>}
  </Layout>
}
export default function App() {
  return <ThemeProvider theme={theme}><CssBaseline /><BrowserRouter><StoreRoutes /></BrowserRouter></ThemeProvider>
}
