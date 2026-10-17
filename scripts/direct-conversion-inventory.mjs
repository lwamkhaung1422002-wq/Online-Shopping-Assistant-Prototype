import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const pos = fileURLToPath(new URL('../../BelleLocal POS app/', import.meta.url))
const sources = [
  'src/features/retails/services/posApi.js',
  'src/features/shop-admin/editor/services/store.js',
]
const methods = []
for (const source of sources) {
  const lines = (await readFile(join(pos, source), 'utf8')).split('\n')
  let group = 'root'
  for (const [index, line] of lines.entries()) {
    const section = line.match(/^    (\w+): \{$/)
    if (section) group = section[1]
    if (/(?:shopRequest|paymentRequest|request|api)\(/.test(line) && !/^\s*(?:return await|const (?:shopRequest|retrySafePayment|paymentRequest)|\/\/)/.test(line)) {
      methods.push({ source, line: index + 1, group, expression: line.trim(), state: 'conversion-required' })
    }
  }
}
const dependencies = []
for (const folder of ['pos', 'online-shop']) {
  for (const file of await readdir(join(pos, 'functions/src', folder))) {
    if (!file.endsWith('.js')) continue
    const source = `functions/src/${folder}/${file}`, content = await readFile(join(pos, source), 'utf8')
    const imports = [...content.matchAll(/from ['"](node:[^'"]+|sharp|bcrypt|jsonwebtoken|firebase-admin[^'"]*)['"]/g)].map(match => match[1])
    if (imports.length) dependencies.push({ source, dependencies: [...new Set(imports)], disposition: 'extract-browser-equivalent-or-report-specific-parity-gap' })
  }
}
const inventory = { date: '2026-10-14', sourceType: 'static transport call-site inventory, not a runtime coverage or parity proof',
  methods, backendDependencies: dependencies,
  implementedDirectContent: ['owner catalogue reads', 'post edit with POS identity/price preservation', 'public content projection transaction', 'slug uniqueness transaction', 'Cloudinary gallery save', 'categories/collections/size-guide/settings saves'],
  pending: ['new-post POS picker/create', 'content record deletion with reference checks', 'original bundled-media resolver', 'public availability projection and authoritative checkout rules', 'guest tracking', 'POS business transport conversion', 'original financial/history direct reader', 'frontend-only ordinary dev', 'Netlify acceptance', 'obsolete code cleanup'],
  rulesStatus: 'draft, not deployed', mainDatabaseWrites: 0,
}
const target = new URL('../docs/evidence/direct-conversion-inventory.json', import.meta.url)
await mkdir(new URL('./', target), { recursive: true })
await writeFile(target, JSON.stringify(inventory, null, 2) + '\n')
console.log(JSON.stringify({ callSites: methods.length, backendFilesWithServerImports: dependencies.length, path: fileURLToPath(target), mainDatabaseRequests: 0 }))
