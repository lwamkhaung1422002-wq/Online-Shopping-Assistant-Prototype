import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { basename, join } from 'node:path'

const plan = JSON.parse(await readFile(new URL('../docs/evidence/main-original-presentation-plan.json', import.meta.url), 'utf8'))
const pos = fileURLToPath(new URL('../../BelleLocal POS app/', import.meta.url))
const presentation = {}, files = {}
for (const product of plan.products) {
  const images = []
  for (const [index, image] of product.images.entries()) {
    const bytes = await readFile(image.file)
    if (createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw Error('Original asset changed; review its mapping before copying.')
    const key = `${product.originalId}/${image.id}`, target = join(pos, 'public/shop-media', product.originalId, basename(image.file))
    await mkdir(join(target, '..'), { recursive: true }); await copyFile(image.file, target)
    files[key] = `/shop-media/${product.originalId}/${basename(image.file)}`
    images.push({ id: image.id, asset_id: key, src: `asset:${key}`, path: `asset:${key}`, color: image.color, alt: product.mainName, is_cover: index === 0, position: index })
  }
  presentation[product.id] = { original_id: product.originalId, main_name: product.mainName, images, guide: product.guide }
}
await writeFile(join(pos, 'src/features/firebase-direct/original-presentation.js'), `// Generated from the reviewed original presentation plan; no Firebase writes.\nexport const originalPresentation = ${JSON.stringify(presentation, null, 2)}\nexport const originalAssetFiles = ${JSON.stringify(files, null, 2)}\n`)
console.log(JSON.stringify({ products: Object.keys(presentation).length, images: Object.keys(files).length, guides: Object.keys(presentation).length, firebaseRequests: 0, changedStock: false }))
