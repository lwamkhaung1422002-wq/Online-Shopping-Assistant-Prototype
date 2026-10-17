import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
  plugins: [react()],
  server: {
    port: 5186,
    strictPort: true,
    headers: { 'X-Belle-Frontend': 'dashboard' },
    open: true,
    proxy: {
      '/api': {
        target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3108',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ''),
      },
    },
  }
  }
})
