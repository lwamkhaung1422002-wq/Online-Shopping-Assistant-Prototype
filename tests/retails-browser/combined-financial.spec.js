import { test, expect } from '@playwright/test'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createShopApi } from '../../../BelleLocal POS app/functions/src/online-shop/api.js'
import { createPosCatalog } from '../../../BelleLocal POS app/functions/src/pos/catalog.js'
import { createPosOrders } from '../../../BelleLocal POS app/functions/src/pos/orders.js'
import { createPosExpenses } from '../../../BelleLocal POS app/functions/src/pos/expenses.js'

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw Error('Combined finance Chrome acceptance requires isolated Firebase services.')
const require = createRequire(new URL('../../../BelleLocal POS app/functions/package.json', import.meta.url))
const { initializeApp } = require('firebase-admin/app'); const { getFirestore } = require('firebase-admin/firestore'); const { getAuth } = require('firebase-admin/auth')
const app = initializeApp({ projectId: 'demo-belle-online' }, 'combined-chrome'); const db = getFirestore(app); const auth = getAuth(app)
const belle = fileURLToPath(new URL('../../../BelleLocal POS app/', import.meta.url))
const at = '2026-10-12T03:00:00.000Z'; const clock = () => Date.parse(at)

test('Actual owner Chrome history combines real checkout/expense with old immutable invoices, receives/completes once and filters dates on desktop/mobile', async ({ page }) => {
  test.setTimeout(180000)
  const uid = 'chrome-finance-' + randomUUID(); const shop = uid; const email = uid + '@belle-demo.example'
  await auth.createUser({ uid, email, password: 'Local-test-only-123!', displayName: 'Fictional financial owner' })
  const old = (name, key) => db.doc(`users/${uid}/${name}/${key}`)
  const legacy = (total, cost, paid) => ({ date: '2026-07-23', total, paymentStatus: paid ? 'paid' : 'unpaid', amountPaid: paid ? total : 0, balanceDue: paid ? 0 : total, fulfillmentStatus: 'reserved', customer: { name: 'Fictional report buyer' }, items: [{ id: 'old-line', type: 'Original design', quantity: 1, unitPrice: total, unitCost: cost }] })
  await old('orders', 'paid').set(legacy(500, 100, true)); await old('orders', 'unpaid').set(legacy(300, 80, false)); await old('expenses', 'rent').set({ date: '2026-07-23', amount: 20 })
  const before = await Promise.all(['paid', 'unpaid'].map(async (key) => (await old('orders', key).get()).data()))
  const product = await createPosCatalog({ db }).create(shop, { name: 'Actual Chrome finance producer', price: 1000, cost: 200, units: [{ name: 'Piece', isBase: true, conversionFactor: 1 }], openingStock: { quantity: 3, unitCost: 200 } }, uid, randomUUID())
  await createPosOrders({ db, now: clock }).create(shop, { saleType: 'IN_STORE', paymentMode: 'FULL', initialPayment: { amount: 1000, method: 'Cash' }, items: [{ productId: product.id, quantity: 1 }] }, uid, randomUUID(), { checkout: true })
  await createPosExpenses({ db, now: clock }).create(shop, { title: 'Chrome finance expense', amount: 30, category: 'Transport' }, uid, randomUUID())
  // A separate Vite preview and the identical real API handler use this clean
  // fictional owner/shop. No intercepted/fabricated responses or edits to the
  // shared Functions configuration, current preview or stale demo originals.
  const handler = createShopApi({ db, auth, ownerUid: uid, allowedShopId: shop, allowedOrigins: ['http://127.0.0.1:5177'] })
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'); req.path = url.pathname; req.query = Object.fromEntries(url.searchParams)
    let body = ''; for await (const chunk of req) body += chunk; req.body = body ? JSON.parse(body) : undefined
    res.set = (key, value) => res.setHeader(key, value); res.status = (value) => { res.statusCode = value; return res }
    res.json = (value) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }; res.send = (value) => res.end(value)
    await handler(req, res)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const api = `http://127.0.0.1:${server.address().port}`
  const vite = spawn(process.execPath, [fileURLToPath(new URL('../../../BelleLocal POS app/node_modules/vite/bin/vite.js', import.meta.url)), '--host', '127.0.0.1', '--port', '5177', '--strictPort','--no-open'], {
    cwd: belle, windowsHide: true, stdio: 'ignore', env: { ...process.env, VITE_POS_V2: 'true', VITE_FIREBASE_DEMO_PROJECT: 'demo-belle-online', VITE_SHOP_ID: shop, VITE_FIREBASE_API_URL: api },
  })
  try {
    await expect.poll(async () => { try { return (await fetch('http://127.0.0.1:5177')).status } catch { return 0 } }, { timeout: 30000 }).toBe(200)
    const errors = []; page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1365, height: 950 }); await page.goto('http://127.0.0.1:5177/#/history')
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email); await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Local-test-only-123!')
    const loaded = page.waitForResponse((response) => response.url().includes('/admin/history/financial?'))
    await page.getByRole('button', { name: /Sign in|Login/i }).click(); expect((await loaded).status()).toBe(200)
    const table = page.getByRole('table', { name: 'Combined financial totals' }); const combined = table.getByRole('row').filter({ hasText: 'Combined' })
    await expect(combined).toContainText('1,500 K'); await expect(combined).toContainText('1,150 K')
    const openUnpaid = async () => page.getByRole('row').filter({ hasText: 'unpaid' }).filter({ has: page.getByRole('button', { name: 'View history' }) }).getByRole('button', { name: 'View history' }).click()
    await openUnpaid(); await page.getByRole('button', { name: 'Receive payment', exact: true }).click()
    const payment = page.getByRole('dialog', { name: 'Receive payment', exact: true }); await payment.getByLabel('Transaction ID (6 digits)').fill('120001'); await payment.getByLabel('Payment date').fill('2026-10-12')
    await payment.getByRole('button', { name: 'Confirm', exact: true }).click(); await expect(payment).not.toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click(); await expect(combined).toContainText('1,800 K'); await expect(combined).toContainText('1,370 K')
    await openUnpaid(); await page.getByRole('button', { name: 'Complete order', exact: true }).click()
    const complete = page.getByRole('dialog', { name: 'Complete order', exact: true }); await complete.getByRole('button', { name: 'Confirm', exact: true }).click(); await expect(complete).not.toBeVisible(); await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(combined).toContainText('1,800 K'); await expect(combined).toContainText('1,370 K')
    await page.screenshot({ path: 'docs/screenshots/combined-financial-desktop.png', fullPage: true })
    await page.getByLabel('Financial from').fill('2026-07-23'); await page.getByLabel('Financial to').fill('2026-07-23'); await expect(combined).toContainText('800 K'); await expect(combined).toContainText('600 K')
    await page.getByRole('button', { name: 'All time', exact: true }).click(); await expect(combined).toContainText('1,800 K')
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await expect(combined).toContainText('1,800 K')
    await expect(page.getByText('Historical sales & payments', { exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    await page.screenshot({ path: 'docs/screenshots/combined-financial-mobile.png', fullPage: true })
    expect(await Promise.all(['paid', 'unpaid'].map(async (key) => (await old('orders', key).get()).data()))).toEqual(before)
    // Deliberately corrupt only this fictional source AFTER preservation was
    // verified. A failed refetch must hide the prior successful cached totals.
    await old('orders', 'unpaid').update({ total: 301 })
    const stale = page.waitForResponse((response) => response.url().includes('/admin/history/financial?'))
    await page.getByRole('button', { name: 'Refresh report', exact: true }).click(); expect((await stale).status()).toBe(409)
    await expect(page.getByRole('alert').filter({ hasText: 'Combined totals are unavailable:' })).toBeVisible({ timeout: 30000 })
    await expect(table).toHaveCount(0); await expect(page.getByRole('textbox', { name: 'Search historical order, customer or phone' })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    // Close the browser's active/refetch connections before its temporary API.
    // An in-flight request must not keep test cleanup waiting indefinitely.
    await page.close()
    if (vite.exitCode === null && vite.signalCode === null) { const exited = once(vite, 'exit'); vite.kill(); await exited }
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
      server.closeAllConnections()
    })
  }
})

test('Current shared preview shows real Functions reconciliation warning and retains searchable original history on desktop/mobile', async ({ page, request }) => {
  test.setTimeout(120000)
  const login = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { data: { email: 'owner@belle-demo.example', password: 'Local-test-only-123!', returnSecureToken: true } })
  expect(login.status()).toBe(200); const headers = { Authorization: 'Bearer ' + (await login.json()).idToken }
  const base = 'http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/history'
  const history = await request.get(base, { headers }); expect(history.status()).toBe(200)
  const data = await history.json(); const stale = data.reconciliation.anomalies.find((entry) => entry.type === 'legacy-source-changed'); expect(stale).toBeTruthy()
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); await page.setViewportSize({ width: 1365, height: 950 }); await page.goto('http://127.0.0.1:5176/#/history')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('owner@belle-demo.example'); await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Local-test-only-123!')
  const financial = page.waitForResponse((response) => response.url().includes('/admin/history/financial?'))
  await page.getByRole('button', { name: /Sign in|Login/i }).click(); expect((await financial).status()).toBe(409)
  await expect(page.getByRole('alert').filter({ hasText: 'Combined totals are unavailable:' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search historical order, customer or phone' }).fill(stale.orderId)
  await expect(page.getByRole('cell', { name: stale.orderId, exact: false }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'View history', exact: true })).toBeVisible(); await page.screenshot({ path: 'docs/screenshots/combined-financial-guard-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileFinancial = page.waitForResponse((response) => response.url().includes('/admin/history/financial?'), { timeout: 90000 })
  await page.reload(); expect((await mobileFinancial).status()).toBe(409)
  await expect(page.getByRole('alert').filter({ hasText: 'Combined totals are unavailable:' })).toBeVisible({ timeout: 30000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy(); await page.screenshot({ path: 'docs/screenshots/combined-financial-guard-mobile.png', fullPage: true }); expect(errors).toEqual([])
})
