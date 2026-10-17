import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importedMediaUrl } from '../dashboard/src/services/imported-media-url.js'

test('known historical photos become same-origin without changing remote images', () => {
  const path = `/original-media/${'a'.repeat(64)}.webp`
  assert.equal(importedMediaUrl(`http://127.0.0.1:5186${path}`), path)
  assert.equal(importedMediaUrl(`http://localhost:5186${path}?v=1`), path + '?v=1')
  for (const value of [undefined, path, 'https://res.cloudinary.com/shop/image/upload/photo.jpg', `http://localhost:9999${path}`, 'http://localhost:5186/private', `http://evil.invalid:5186${path}`]) assert.equal(importedMediaUrl(value), value)
})
