import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import './index.css'
import App from './App.jsx'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import StoreProvider from './components/StoreProvider.jsx'
import CartProvider from './components/CartProvider.jsx'
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: (count, error) => error?.code !== 'FIRESTORE_QUOTA_EXCEEDED' && count < 1, staleTime: 60000, refetchOnWindowFocus: false, refetchOnReconnect: false } } })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}><StoreProvider><CartProvider><App /></CartProvider></StoreProvider></QueryClientProvider>
  </StrictMode>,
)
