import { BrowserRouter, Routes, Route } from 'react-router'
import { ThemeProvider, CssBaseline } from '@mui/material'
import theme from './theme/theme.js'
import Layout from './components/Layout.jsx'
import CatalogPage from './pages/CatalogPage.jsx'
import ProductPage from './pages/ProductPage.jsx'
import OrderPage from './pages/OrderPage.jsx'
import CartPage from './pages/CartPage.jsx'
import CheckoutPage from './pages/CheckoutPage.jsx'
import TrackingPage from './pages/TrackingPage.jsx'
import { Alert } from '@mui/material'

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<CatalogPage />} />
            <Route path="/product/:id" element={<ProductPage />} />
            <Route path="/product/:id/order" element={<OrderPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/track" element={<TrackingPage />} />
            <Route path="/order/success" element={<TrackingPage confirmation />} />
            <Route path="*" element={<Alert severity="warning">Page not found.</Alert>} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </ThemeProvider>
  )
}
