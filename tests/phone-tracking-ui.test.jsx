import { afterEach, expect, it, vi } from 'vitest'
import { createElement, act } from '../dashboard/node_modules/react/index.js'
import { createRoot } from '../dashboard/node_modules/react-dom/client.js'
import { MemoryRouter } from '../dashboard/node_modules/react-router/dist/development/index.js'
import { QueryClient, QueryClientProvider } from '../dashboard/node_modules/@tanstack/react-query/build/modern/index.js'
import { rememberTrackingOrder } from '../dashboard/src/services/tracking-history.js'
const mocks = vi.hoisted(() => ({ track: vi.fn(), submit: vi.fn(), values: { name: 'Buyer', phone: '09123456789', city: 'City', address: 'Address' } }))
vi.mock('../dashboard/src/services/client.js', () => ({ configured: true, shopId: 'shop' }))
vi.mock('../dashboard/src/services/orders.js', async original => ({ ...await original(), trackOrder: mocks.track, submitOrder: mocks.submit }))
vi.mock('../dashboard/src/services/cart-context.js', () => ({ useCart: () => ({ cart: [{ variant_id: 'variant', quantity: 1, measurements: {} }], lines: [{ quantity: 1, product: { name: 'Belle Dress' }, variant: { available: 2 }, selected_price: 12000, selection: { valid: true, options: [] } }], clear: vi.fn() }) }))
vi.mock('../dashboard/src/services/store-context.js', () => ({ useStore: () => ({ configured: true, loading: false, settings: { delivery_fee: 0, checkout_enabled: true } }) }))
vi.mock('../dashboard/src/components/OrderForm.jsx', () => ({ default: ({ onSubmit, busy }) => createElement('button', { disabled: busy, onClick: () => onSubmit(mocks.values) }, 'Submit fixture order') }))
vi.mock('../dashboard/src/components/CheckoutVerification.jsx', () => ({ default: () => null }))
import TrackingPage from '../dashboard/src/pages/TrackingPage.jsx'
import CheckoutPage from '../dashboard/src/pages/CheckoutPage.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, client, container
const token = 'a'.repeat(64)
async function mount(url = '/track', Page = TrackingPage) {
  mocks.track.mockResolvedValue({ reference: 'mine', status: 'pending', total: 12000, delivery_fee: 0, items: [{ name: 'Belle Dress', quantity: 1, unit_price: 12000, color: 'Rose', size: 'S' }], events: [{ status: 'pending', created_at: '2026-10-17T00:00:00Z' }] })
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  await act(async () => { root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(QueryClientProvider, { client }, createElement(Page)))) })
}
const button = label => [...container.querySelectorAll('button')].find(node => node.textContent === label)
async function click(node) { await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
async function search(phone) {
  await act(async () => {
    const input = container.querySelector('input[type="tel"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, phone)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
}
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); container?.remove(); root = null; localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); vi.unstubAllEnvs() })

it('finds locally owned orders by phone, opens details and returns without manual references', async () => {
  rememberTrackingOrder(localStorage, 'shop', { reference: 'mine', tracking_token: token }, '09123456789')
  rememberTrackingOrder(localStorage, 'shop', { reference: 'other', tracking_token: 'b'.repeat(64) }, '09999999999')
  await mount()
  expect(mocks.track).not.toHaveBeenCalled()
  expect(container.textContent).not.toContain('Order reference')
  expect(container.textContent).not.toContain('Private tracking token')
  await search('+95 9 123456789')
  expect(mocks.track).toHaveBeenCalledWith('mine', token)
  expect(mocks.track).not.toHaveBeenCalledWith('other', expect.anything())
  expect(container.textContent).toContain('Belle Dress')
  await click(button('View order 1'))
  expect(container.textContent).toContain('12,000 MMK')
  await click(button('Back to orders'))
  expect(container.querySelector('input[type="tel"]').value).toBe('+95 9 123456789')
})
it('invalid or unmatched phone never triggers a server-wide phone lookup', async () => {
  await mount(); await search('abc')
  expect(container.textContent).toContain('Enter a valid Myanmar 09 phone number.')
  await search('09123456789')
  expect(container.textContent).toContain('No saved orders match this phone')
  expect(mocks.track).not.toHaveBeenCalled()
})
it('keeps existing private links working on another browser without saved history', async () => {
  await mount(`/track#reference=mine&token=${token}`)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
  expect(mocks.track).toHaveBeenCalledWith('mine', token)
  expect(container.textContent).toContain('Belle Dress')
  expect(container.querySelector('input[type="tel"]')).toBeNull()
})
it('checkout retry remembers the committed request phone and original retry identity', async () => {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
  mocks.values = { name: 'Buyer', phone: '09123456789', city: 'City', address: 'Address' }
  mocks.submit.mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValueOnce({ reference: 'mine', tracking_token: token })
  await mount('/checkout', CheckoutPage)
  await click(button('Submit fixture order'))
  const originalRequest = mocks.submit.mock.calls[0][0]
  expect(container.textContent).toContain('Connection interrupted')
  mocks.values = { ...mocks.values, phone: '09999999999' }
  await click(button('Submit fixture order'))
  expect(mocks.submit.mock.calls[1][0]).toEqual(originalRequest)
  const history = JSON.parse(localStorage.getItem('os-orders:shop'))
  expect(history).toEqual([{ reference: 'mine', token, phone: '09123456789' }])
})
