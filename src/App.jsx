import { BrowserRouter, Routes, Route } from 'react-router'
import { ThemeProvider, CssBaseline } from '@mui/material'
import theme from './theme/theme.js'
import Layout from './components/Layout.jsx'
import CatalogPage from './pages/CatalogPage.jsx'
import ProductPage from './pages/ProductPage.jsx'
import OrderPage from './pages/OrderPage.jsx'
import SuccessPage from './pages/SuccessPage.jsx'

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
            <Route path="/order/success" element={<SuccessPage />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </ThemeProvider>
  )
}
