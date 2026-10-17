export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const allowed = new Set(['image/jpeg', 'image/png', 'image/webp'])
export function validateImage(file) {
  if (!allowed.has(file.type)) throw new Error('Use JPEG, PNG or WebP images.')
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error('Each image must be 5 MB or smaller.')
}
export async function prepareImage(file) {
  validateImage(file)
  const bitmap = await createImageBitmap(file)
  try {
    const ratio = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86))
    if (!blob) throw new Error('Unable to process this image.')
    if (blob.size > MAX_IMAGE_BYTES) throw new Error('Image is too large after optimization.')
    return blob
  } finally { bitmap.close() }
}
