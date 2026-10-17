import { productImages } from '../config/productImages.js'

export function resolveOriginalImage(image) {
  if (!image.src?.startsWith('asset:')) return image
  const key = image.src.slice(6), parts = key.split('/')
  const original = productImages[parts[0]]?.find(value => value.id === parts[1])
  if (parts.length !== 2 || !original || image.asset_id !== key) throw new Error('Original product image mapping requires review.')
  return { ...image, src: original.src }
}
