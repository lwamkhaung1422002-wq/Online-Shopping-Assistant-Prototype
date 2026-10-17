import { spawnSync } from 'node:child_process'
const shop = (process.env.VITE_SHOP_ID || '').trim()
if (!/^[A-Za-z0-9_-]{1,128}$/.test(shop) || /replace|your-shop/i.test(shop)) {
  console.error('Set VITE_SHOP_ID to the verified POS shop ID in the hosting build environment.')
  process.exit(1)
}
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  stdio: 'inherit', env: { ...process.env, VITE_SHOP_ID: shop, VITE_PUBLIC_API_BASE_URL: '/api' },
})
process.exit(result.status ?? 1)
