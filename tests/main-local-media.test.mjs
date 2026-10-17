import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createLocalMediaBucket } from '../../BelleLocal POS app/functions/src/main-local/local-media.js'
import { createImageService } from '../../BelleLocal POS app/functions/src/online-shop/images.js'
import { createShopApi } from '../../BelleLocal POS app/functions/src/online-shop/api.js'
import { normalizeProduct } from '../../BelleLocal POS app/functions/src/online-shop/domain.js'
import { MAIN_OWNER_UID as owner, MAIN_SHOP_ID as shop } from '../../BelleLocal POS app/functions/src/main-readonly/constants.js'

const require = createRequire(new URL('../../BelleLocal POS app/functions/package.json', import.meta.url)), sharp = require('sharp')
function fixtureDatabase() {
  const values = new Map(), copy = value => value === undefined ? undefined : structuredClone(value)
  function snapshot(ref) { return { id: ref.id, ref, exists: values.has(ref.path), data: () => copy(values.get(ref.path)) } }
  function doc(path) {
    const ref = { path, id: path.split('/').at(-1), get: async () => snapshot(ref),
      create: async value => { if (values.has(path)) throw Error('Fixture document already exists'); values.set(path, copy(value)) },
      set: async value => { values.set(path, copy(value)) }, update: async value => { if (!values.has(path)) throw Error('Fixture document not found'); values.set(path, { ...values.get(path), ...copy(value) }) } }
    return ref
  }
  return { projectId: 'demo-local-media-fixture', doc, values,
    collection: path => ({ get: async () => { const docs = [...values.keys()].filter(key => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1).map(key => snapshot(doc(key))); return { docs, size: docs.length, empty: !docs.length } } }),
    async runTransaction(action) {
      const changes = [], tx = { get: ref => ref.get(), create: (ref, value) => { changes.push(() => ref.create(value)); return tx }, set: (ref, value) => { changes.push(() => ref.set(value)); return tx }, update: (ref, value) => { changes.push(() => ref.update(value)); return tx } }
      const result = await action(tx); for (const change of changes) await change(); return result
    } }
}

test('local ImageService upload/inspection/gallery and token downloads persist with safe paths, generation writes and conditional deletion', { timeout: 30_000 }, async () => {
  const temporaryBase = await realpath(tmpdir()), temporaryRoot = await mkdtemp(join(temporaryBase, 'main-local-media-test-'))
  try {
    await assert.rejects(createLocalMediaBucket({ root: 'relative-media' }), { code: 400 })
    const bucket = await createLocalMediaBucket({ root: temporaryRoot }), storageOrigin = 'http://127.0.0.1:5003', db = fixtureDatabase()
    const product = normalizeProduct({ name: 'Photo fixture dress', slug: 'photo-fixture', status: 'published', variants: [{ size: 'Size 1', color: 'Brown', sku: 'photo-fixture-choice', price: 39500, active: true }] }, null, shop)
    product.privateCost = 12345
    const productRef = db.doc(`onlineShopV2/${shop}/products/${product.id}`)
    await productRef.create(product)
    await db.doc(`users/${owner}/orders/original`).create({ customer: { name: 'Private original buyer', phone: 'Private original phone' } })
    const originalBefore = (await db.doc(`users/${owner}/orders/original`).get()).data()
    const image = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 90, g: 50, b: 20, alpha: 1 } } }).webp().toBuffer()
    const images = createImageService({ db, bucket, storageOrigin })
    const uploaded = await images.upload(shop, { parentId: product.id, bucket: 'product-images', data: image.toString('base64') })
    const url = new URL(uploaded.path), prefix = `/v0/b/${bucket.name}/o/`, encodedObjectName = url.pathname.slice(prefix.length), objectName = decodeURIComponent(encodedObjectName), token = url.searchParams.get('token')
    assert.ok(url.pathname.startsWith(prefix)); assert.equal(url.origin, storageOrigin)
    assert.ok(objectName.startsWith(`onlineShopV2/${shop}/product-images/${product.id}/`))
    const attachment = await images.inspect(shop, uploaded.path, 'product-images', product.id)
    assert.ok(attachment)
    const [metadata] = await bucket.file(objectName).getMetadata()
    assert.equal(metadata.contentType, 'image/webp'); assert.equal(metadata.metadata.firebaseStorageDownloadTokens, token)
    assert.equal(metadata.generation, attachment.generation); assert.ok(!('root' in metadata))
    assert.deepEqual((await bucket.file(objectName).download())[0], image)
    const download = await bucket.readDownload({ encodedObjectName, token })
    assert.deepEqual(download.bytes, image); assert.equal(download.contentType, 'image/webp'); assert.equal(download.contentLength, image.length)
    assert.equal(download.cacheControl, 'private, no-store')

    const handler = createShopApi({ db, bucket, storageOrigin, allowedShopId: shop, ownerUid: owner, managedShopRouting: false, allowedOrigins: ['http://127.0.0.1:5178'], auth: { verifyIdToken: async () => ({ uid: owner }) } })
    async function request(method, route, body) {
      let status = 200, data
      const res = { set: () => res, status: value => { status = value; return res }, json: value => { data = value; return res } }
      await handler({ method, path: `/${shop}/${route}`, body, headers: { origin: 'http://127.0.0.1:5178', authorization: 'Bearer fixture-owner' } }, res)
      return { status, data }
    }
    const gallery = await request('POST', `admin/products/${product.id}/gallery`, { images: [{ path: uploaded.path, alt: 'Owner dress photo', color: 'Brown', is_cover: true }] })
    assert.equal(gallery.status, 200); assert.equal(gallery.data.saved, true)
    const attachedProduct = (await productRef.get()).data()
    assert.equal(attachedProduct.images[0].src, uploaded.path); assert.equal(attachedProduct.images[0].is_cover, true)
    assert.equal(attachedProduct.privateCost, product.privateCost)
    const catalogue = await request('GET', 'catalog')
    assert.equal(catalogue.status, 200); assert.equal(catalogue.data[0].images[0].src, uploaded.path)
    for (const value of ['privateCost', 'Private original buyer', 'Private original phone']) assert.ok(!JSON.stringify(catalogue.data).includes(value))

    const wrongToken = randomUUID()
    await assert.rejects(bucket.readDownload({ encodedObjectName, token: wrongToken }), { code: 403 })
    await assert.rejects(bucket.readDownload({ encodedObjectName, token: '../../private' }), { code: 403 })
    for (const name of [objectName.replace(`/${shop}/`, '/other-shop/'), `users/${owner}/orders/original`, objectName.replace('/product-images/', '/payments/'), objectName.replace(`/${product.id}/`, '/../'), objectName.replace(/[^/]+$/, 'original-record.webp'), `onlineShopV2/${shop}/shop-logos/not-main/${randomUUID()}.webp`, `${objectName}/../../private`]) {
      assert.throws(() => bucket.file(name), { code: 403 })
      await assert.rejects(bucket.readDownload({ encodedObjectName: encodeURIComponent(name), token }), { code: 403 })
    }
    await assert.rejects(bucket.readDownload({ encodedObjectName: encodeURIComponent(encodedObjectName), token }), { code: 403 })
    assert.equal(await images.inspect('other-shop', uploaded.path, 'product-images', product.id), null)
    assert.equal(await images.inspect(shop, uploaded.path.replace(token, wrongToken), 'product-images', product.id), null)
    const options = expected => ({ preconditionOpts: { ifGenerationMatch: expected }, metadata: { contentType: 'image/webp', metadata: { firebaseStorageDownloadTokens: token } } })
    await assert.rejects(bucket.file(objectName).save(image, options(0)), { code: 412 })
    await assert.rejects(bucket.file(objectName).save(image, options('1')), { code: 412 })
    assert.deepEqual((await bucket.file(objectName).getMetadata())[0], metadata)
    assert.deepEqual((await bucket.file(objectName).download())[0], image)
    await assert.rejects(bucket.file(objectName).delete({ ifGenerationMatch: '1' }), { code: 412 })
    await assert.rejects(bucket.file(objectName).delete(), { code: 412 })

    const reopened = await createLocalMediaBucket({ root: temporaryRoot })
    assert.deepEqual((await reopened.file(objectName).getMetadata())[0], metadata)
    assert.deepEqual((await reopened.readDownload({ encodedObjectName, token })).bytes, image)
    assert.ok(await createImageService({ db, bucket: reopened, storageOrigin }).inspect(shop, uploaded.path, 'product-images', product.id))
    const orphanName = `onlineShopV2/${shop}/size-guide-images/fixture-guide/${randomUUID()}.webp`, orphan = reopened.file(orphanName)
    const competing = await Promise.allSettled([orphan.save(image, options(0)), bucket.file(orphanName).save(image, options(0))])
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(competing.find(result => result.status === 'rejected').reason.code, 412)
    const [orphanBefore] = await orphan.getMetadata()
    await orphan.save(image, options(orphanBefore.generation))
    const [orphanAfter] = await orphan.getMetadata()
    assert.notEqual(orphanBefore.generation, orphanAfter.generation)
    await assert.rejects(orphan.delete({ ifGenerationMatch: orphanBefore.generation }), { code: 412 })
    await orphan.delete({ ifGenerationMatch: orphanAfter.generation })
    await assert.rejects(orphan.getMetadata(), { code: 404 })
    await assert.rejects(reopened.readDownload({ encodedObjectName: encodeURIComponent(orphanName), token }), { code: 404 })
    assert.deepEqual((await db.doc(`users/${owner}/orders/original`).get()).data(), originalBefore)
    assert.deepEqual((await reopened.file(objectName).download())[0], image)
  } finally {
    // Remove only the isolated directory created by this test, after resolving
    // and checking its exact parent/name; never enumerate or touch user files.
    const resolved = resolve(await realpath(temporaryRoot))
    assert.equal(dirname(resolved), resolve(temporaryBase)); assert.ok(resolved.split(/[\\/]/).at(-1).startsWith('main-local-media-test-'))
    await rm(resolved, { recursive: true, force: true })
  }
})
