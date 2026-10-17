import { api } from './client.js'
import { importedMediaUrl } from './imported-media-url.js'
export const fetchCatalog = async () => (await api('catalog')).map(post => ({
  ...post,
  images: (post.images || []).map(image => ({ ...image, src: importedMediaUrl(image.src) })),
  guide: post.guide ? { ...post.guide, image_path: importedMediaUrl(post.guide.image_path) } : post.guide,
}))
export const fetchSettings = () => api('settings')
export function fetchTaxonomy(table) {
  if (!['categories', 'collections'].includes(table)) throw new Error('Invalid catalog section.')
  return api(`taxonomy/${table}`)
}
