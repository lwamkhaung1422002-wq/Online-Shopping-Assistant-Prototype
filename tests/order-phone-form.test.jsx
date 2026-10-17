import { afterEach, expect, it, vi } from 'vitest'
import { createElement, act } from '../dashboard/node_modules/react/index.js'
import { createRoot } from '../dashboard/node_modules/react-dom/client.js'
import OrderForm from '../dashboard/src/components/OrderForm.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); root = null })

it.each(['၀၉၁၂၃၄၅၆၇၈၉', '+95 9 123456789'])('submits canonical phone from %s in the actual customer form', async phone => {
  const submit = vi.fn()
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  await act(async () => root.render(createElement(OrderForm, { onSubmit: submit, defaults: { name: 'Acceptance', city: 'Test city', address: 'Test address', phone: '' } })))
  await act(async () => {
    const input = container.querySelector('input[type="tel"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, phone)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(submit).toHaveBeenCalledTimes(1)
  expect(submit.mock.calls[0][0].phone).toBe('09123456789')
})
