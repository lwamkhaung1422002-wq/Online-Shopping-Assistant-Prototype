import { api } from './client.js'
export const fetchCatalog = () => api('catalog')
export const fetchSettings = () => api('settings')
export function fetchTaxonomy(table) {
  if (!['categories', 'collections'].includes(table)) throw new Error('Invalid catalog section.')
  return api(`taxonomy/${table}`)
}
