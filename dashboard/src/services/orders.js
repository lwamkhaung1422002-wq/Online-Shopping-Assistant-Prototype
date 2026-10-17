import { api } from './client.js'

async function invoke(name, body) {
  return api(name, body)
}
export function submitOrder(request, challenge) {
  const { request_key, tracking_token, customer, note, items } = request
  return invoke('checkout', { request_key, tracking_token, customer, note, items, challenge })
}
export function trackOrder(reference, token) {
  return invoke('track-order', { reference, tracking_token: token })
}
export function newTrackingToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, '0')).join('')
}
export function trackingHash(reference, token) {
  return new URLSearchParams({ reference, token }).toString()
}
