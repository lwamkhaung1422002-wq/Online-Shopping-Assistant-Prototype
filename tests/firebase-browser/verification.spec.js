import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
const api = 'http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/'

test('a lost accepted response then failed verification retains the same request and refreshes its widget token', async ({ page, request }) => {
  const signIn = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',
    { data: { email: 'owner@belle-demo.example', password: 'Local-test-only-123!', returnSecureToken: true } })
  expect(signIn.ok()).toBeTruthy()
  const auth = { Authorization: 'Bearer ' + (await signIn.json()).idToken }
  const label = 'Retry Dress ' + randomUUID().slice(0, 8)
  const create = await request.post(api + 'admin/products', { headers: auth, data: { name: label, slug: 'retry-' + randomUUID(), status: 'published',
    variants: [{ color: 'Brown', size: 'S', sku: randomUUID(), price: 4500, active: true }] } })
  expect(create.ok()).toBeTruthy(); const productId = await create.json()
  const product = await (await request.get(api + 'admin/products/' + productId, { headers: auth })).json()
  const variant = product.variants[0]
  expect((await request.post(api + 'admin/inventory', { headers: auth, data: { variantId: variant.id, delta: 2, note: 'Retry test' } })).ok()).toBeTruthy()

  // This tests widget lifecycle, not a real Cloudflare challenge. Real production
  // Siteverify destination acceptance remains a separate pre-release gate.
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    window.widgetTokens = []; window.removedWidgets = [];
    window.turnstile = {
      render(node, options) { const token = 'widget-token-' + (window.widgetTokens.length + 1); window.widgetTokens.push(token);
        Promise.resolve().then(() => options.callback(token)); return token; },
      remove(id) { window.removedWidgets.push(id); }
    };` }))
  const payloads = []
  await page.route('**/belle-online/checkout', async (route) => {
    payloads.push(route.request().postDataJSON())
    if (payloads.length === 1) {
      const accepted = await route.fetch(); expect(accepted.ok()).toBeTruthy()
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Connection interrupted. Retry your request.', order_rejected: false }) })
    } else if (payloads.length === 2) {
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Please complete verification again.', order_rejected: false }) })
    } else await route.continue()
  })
  await page.goto('http://127.0.0.1:5175/')
  await page.getByText(label, { exact: true }).click()
  await page.getByRole('button', { name: 'Add to cart', exact: true }).click()
  await page.getByRole('link', { name: 'View cart', exact: true }).click()
  await page.getByRole('link', { name: 'Checkout', exact: true }).click()
  const buyer = 'Retry Buyer ' + randomUUID().slice(0, 8)
  await page.getByLabel(/\/ Name/).fill(buyer); await page.getByLabel(/\/ Phone/).fill('09942988167')
  await page.getByLabel(/\/ City/).fill('Yangon'); await page.getByLabel(/\/ Delivery address/).fill('Test address')
  await expect.poll(() => page.evaluate(() => window.widgetTokens?.length || 0)).toBe(1)
  await page.getByRole('button', { name: 'Place order', exact: true }).click()
  await expect(page.getByText('Connection interrupted. Retry your request.', { exact: true })).toBeVisible()
  const pendingKey = await page.evaluate(() => JSON.parse(sessionStorage.getItem('os-checkout:belle-online')).request_key)
  await expect.poll(() => page.evaluate(() => window.widgetTokens.length)).toBe(2)
  await page.getByRole('button', { name: 'Retry this order', exact: true }).click()
  await expect(page.getByText('Please complete verification again.', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('os-checkout:belle-online')).request_key)).toBe(pendingKey)
  await expect.poll(() => page.evaluate(() => window.widgetTokens.length)).toBe(3)
  await page.getByRole('button', { name: 'Retry this order', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Order request received' })).toBeVisible()
  expect(new Set(payloads.map((body) => body.request_key)).size).toBe(1)
  expect(new Set(payloads.map((body) => body.challenge)).size).toBe(3)
  expect(payloads.every((body) => body.tracking_token === payloads[0].tracking_token)).toBeTruthy()
  const orders = await (await request.get(api + 'admin/records/orders', { headers: auth })).json()
  expect(orders.filter((order) => order.customer_name === buyer)).toHaveLength(1)
  const after = await (await request.get(api + 'admin/products/' + productId, { headers: auth })).json()
  expect(after.variants[0].reserved).toBe(1)
})
