import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'

const api = 'http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
const preview = 'http://127.0.0.1:5176/#/sale/'

async function authenticate(request) {
  const response = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
    data: { email: 'owner@belle-demo.example', password: 'Local-test-only-123!', returnSecureToken: true },
  })
  expect(response.status()).toBe(200)
  return { Authorization: 'Bearer ' + (await response.json()).idToken }
}

async function create(request, headers, path, data) {
  const response = await request.post(api + path, { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data })
  expect(response.status(), await response.text()).toBe(201)
  return response.json()
}

async function detail(request, headers, orderId) {
  const response = await request.get(api + 'orders/' + orderId, { headers })
  expect(response.status()).toBe(200)
  return response.json()
}

async function signIn(page, orderId) {
  await page.goto(preview + orderId)
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('owner@belle-demo.example')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Local-test-only-123!')
  await page.getByRole('button', { name: /Sign in|Login/i }).click()
  await expect(page.getByRole('button', { name: 'Print Invoice', exact: true })).toBeVisible({ timeout: 40000 })
}

async function printedInvoice(page) {
  // Exercise the real popup/document and onload callback without opening a printer dialog.
  await page.evaluate(() => {
    const open = window.open.bind(window)
    window.open = (...args) => {
      const popup = open(...args)
      if (popup) popup.print = () => { popup.__printCalls = (popup.__printCalls || 0) + 1 }
      return popup
    }
  })
  const opened = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Print Invoice', exact: true }).click()
  const popup = await opened
  await popup.waitForFunction(() => window.__printCalls === 1)
  await expect(popup.locator('.reprint')).toHaveText('REPRINT')
  expect(await popup.evaluate(() => window.opener)).toBeNull()
  return popup
}

async function downloadInvoice(page, number, filename) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined })
  })
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Share Invoice', exact: true }).click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('Invoice-' + number + '.pdf')
  await mkdir('.local/artifacts/output/pdf', { recursive: true })
  await download.saveAs('.local/artifacts/output/pdf/' + filename)
  const bytes = await readFile('.local/artifacts/output/pdf/' + filename)
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  return bytes.toString('latin1')
}

test('actual invoice prints saved units and payments, downloads the reference A5 PDF, and handles blocked/cancelled/failed output on desktop/mobile', async ({ page, request }) => {
  test.setTimeout(150000)
  const headers = await authenticate(request), suffix = randomUUID().slice(0, 6), errors = []
  page.on('pageerror', error => errors.push(error.message))
  const { product } = await create(request, headers, 'products', {
    name: 'Invoice pack ' + suffix, price: 500, cost: 100,
    units: [{ name: 'Piece', isBase: true, conversionFactor: 1 }, { name: 'Pack', isBase: false, conversionFactor: 3 }],
    openingStock: { quantity: 12, unitCost: 100 },
  })
  const { product: single } = await create(request, headers, 'products', {
    name: 'Invoice single ' + suffix, price: 700, cost: 100,
    units: [{ name: 'Piece', isBase: true, conversionFactor: 1 }], openingStock: { quantity: 3, unitCost: 100 },
  })
  const customerName = 'Rina & Co <VIP> ' + suffix
  const { customer } = await create(request, headers, 'customers', { name: customerName, phone: '099999999' })
  const { order } = await create(request, headers, 'orders/checkout', {
    saleType: 'IN_STORE', paymentMode: 'PARTIAL', customerId: customer.id, discount: 100, expectedTotal: 3600,
    initialPayment: { method: 'Cash', amount: 1100 },
    items: [{ productId: product.id, unitId: product.units.find(unit => !unit.isBase).unitId, quantity: 2 }, { productId: single.id, quantity: 1 }],
  })
  const original = await detail(request, headers, order.id)
  expect(original.receipt.totals).toMatchObject({ subtotal: 3700, orderDiscount: 100, total: 3600, paid: 1100, outstanding: 2500 })
  expect(original.receipt.items[0]).toMatchObject({ enteredQuantity: '2', baseQuantity: '6', unitName: 'Pack', unitPrice: 1500 })

  // Current catalogue/contact edits must never rewrite the saved selling facts on an invoice.
  const changedProduct = await request.patch(api + 'products/' + product.id, {
    headers, data: { name: 'Current catalogue ' + suffix, price: 900, expectedVersion: product.version },
  })
  expect(changedProduct.status()).toBe(200)
  const changedCustomer = await request.patch(api + 'customers/' + customer.id, { headers, data: { name: 'Current customer ' + suffix } })
  expect(changedCustomer.status()).toBe(200)
  await page.setViewportSize({ width: 1365, height: 950 })
  await signIn(page, order.id)
  await expect(page.getByText(product.name, { exact: true }).first()).toBeVisible()

  await page.evaluate(() => { window.__originalOpen = window.open; window.open = () => null })
  await page.getByRole('button', { name: 'Print Invoice', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Allow pop-ups to print this receipt.')
  await page.evaluate(() => { window.open = window.__originalOpen })
  const popup = await printedInvoice(page)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(popup.locator('.invoice')).toContainText(order.orderNumber)
  await expect(popup.locator('.meta')).toContainText(customerName)
  const originalDate = await popup.evaluate(value => new Date(value).toLocaleString(), original.receipt.transactionAt)
  await expect(popup.locator('.meta')).toContainText(originalDate)
  await expect(popup.locator('tbody')).toContainText('2 Pack x 1,500 MMK')
  await expect(popup.locator('tbody')).not.toContainText('6 Pack')
  await expect(popup.locator('tbody')).toContainText(product.name)
  await expect(popup.locator('tbody')).not.toContainText('Current catalogue')
  await expect(popup.locator('.summary .total')).toContainText('3,600 MMK')
  await expect(popup.locator('.summary')).toContainText('Outstanding2,500 MMK')
  await popup.screenshot({ path: 'docs/screenshots/retails-invoice-thermal-partial.png', fullPage: true })
  await popup.close()
  const pdf = await downloadInvoice(page, order.orderNumber, 'retails-invoice-partial.pdf')
  for (const text of [order.orderNumber, product.name, '2 Pack', 'MMK 1,500', 'MMK 3,600', 'Partial']) expect(pdf).toContain(text)
  expect(pdf).not.toContain('Current catalogue')

  await create(request, headers, 'orders/' + order.id + '/payments', { method: 'Cash', scope: 'credit-settlement' })
  const settled = await detail(request, headers, order.id)
  expect(settled.receipt.totals).toMatchObject({ paid: 3600, outstanding: 0 })
  expect(settled.receipt.payments).toHaveLength(2)
  expect(settled.receipt.payments.find(entry => entry.id === original.receipt.payments[0].id)).toEqual(original.receipt.payments[0])
  expect(settled.receipt.transactionAt).toBe(original.receipt.transactionAt)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Print Invoice', exact: true })).toBeVisible({ timeout: 30000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const reprint = await printedInvoice(page)
  await expect(reprint.locator('.meta')).toContainText(originalDate)
  await expect(reprint.locator('.summary')).toContainText('Paid3,600 MMK')
  await expect(reprint.locator('.summary')).toContainText('Outstanding0 MMK')
  await reprint.close()
  await page.screenshot({ path: 'docs/screenshots/retails-invoice-output-mobile.png', fullPage: true })
  const mobilePdf = await downloadInvoice(page, order.orderNumber, 'retails-invoice-paid.pdf')
  expect(mobilePdf).toContain('(Paid)')

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', { configurable: true, value: async ({ files }) => {
      window.__sharedInvoice = { name: files[0].name, type: files[0].type, size: files[0].size }
      await new Promise(resolve => { window.__releaseShare = resolve })
    } })
  })
  const share = page.getByRole('button', { name: 'Share Invoice', exact: true })
  await share.click()
  await expect(share).toBeDisabled()
  await page.waitForFunction(() => Boolean(window.__releaseShare))
  expect(await page.evaluate(() => window.__sharedInvoice)).toMatchObject({ name: 'Invoice-' + order.orderNumber + '.pdf', type: 'application/pdf' })
  expect(await page.evaluate(() => window.__sharedInvoice.size)).toBeGreaterThan(1000)
  await page.evaluate(() => window.__releaseShare())
  await expect(share).toBeEnabled()
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('Sharing is unavailable.', 'NotAllowedError') } })
  })
  await share.click()
  await expect(page.getByRole('alert')).toHaveText('Sharing is unavailable.')
  await page.screenshot({ path: 'docs/screenshots/retails-invoice-output-error-mobile.png', fullPage: true })
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('Share cancelled.', 'AbortError') } })
  })
  await share.click()
  await expect(share).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await detail(request, headers, order.id)).toEqual(settled)
  expect(errors).toEqual([])
})

test('returned invoice reprints original totals/refund references and downloads the same effective total as reference Sale Details without changing records', async ({ page, request }) => {
  test.setTimeout(90000)
  const headers = await authenticate(request), suffix = randomUUID().slice(0, 6), errors = []
  page.on('pageerror', error => errors.push(error.message))
  const { product } = await create(request, headers, 'products', {
    name: 'Returned invoice ' + suffix, price: 500, cost: 100,
    units: [{ name: 'Piece', isBase: true, conversionFactor: 1 }], openingStock: { quantity: 4, unitCost: 100 },
  })
  const { order } = await create(request, headers, 'orders/checkout', {
    saleType: 'IN_STORE', paymentMode: 'FULL', initialPayment: { method: 'Cash', amount: 1500 }, items: [{ productId: product.id, quantity: 3 }],
  })
  for (const reason of ['Size return', 'Colour return']) await create(request, headers, 'orders/' + order.id + '/product-returns', {
    items: [{ orderItemId: order.items[0].id, quantity: 1, condition: 'SELLABLE', reason }], refundMethod: 'Cash',
  })
  const saved = await detail(request, headers, order.id)
  expect(saved.receipt.totals.total).toBe(1500)
  expect(saved.receipt.effectiveTotal).toBe(500)
  expect(saved.receipt.returns).toHaveLength(2)
  expect(saved.receipt.refunds).toHaveLength(2)
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, order.id)
  const popup = await printedInvoice(page)
  await expect(popup.locator('.summary .total')).toContainText('1,500 MMK')
  for (const entry of [...saved.receipt.returns, ...saved.receipt.refunds]) await expect(popup.locator('.references')).toContainText(entry.id)
  await popup.screenshot({ path: 'docs/screenshots/retails-invoice-thermal-returned.png', fullPage: true })
  await popup.close()
  const pdf = await downloadInvoice(page, order.orderNumber, 'retails-invoice-returned.pdf')
  expect(pdf).toContain('MMK 500')
  expect(pdf).toContain(product.name)
  expect(await detail(request, headers, order.id)).toEqual(saved)
  expect(errors).toEqual([])
})
