import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { getSizeConfig } from '../dashboard/src/config/sizeRules.js'
import { digest } from '../../BelleLocal POS app/functions/src/pos/mutation.js'
import { assertMainLocalStartup } from '../../BelleLocal POS app/functions/src/main-local/startup.js'
import { createMainSidecarFirestore } from '../../BelleLocal POS app/functions/src/main-local/firestore.js'
import { createImageService } from '../../BelleLocal POS app/functions/src/online-shop/images.js'
import { createLocalMediaBucket } from '../../BelleLocal POS app/functions/src/main-local/local-media.js'

const planFile = new URL('../docs/evidence/main-original-presentation-plan.json', import.meta.url)
async function prepare() {
  const original = JSON.parse(await readFile(new URL('../dashboard/src/config/products.json',import.meta.url),'utf8'))
  const saved = JSON.parse(await readFile(new URL('../docs/evidence/main-public-catalogue-created.json',import.meta.url),'utf8'))
  const imageModule = new URL('../dashboard/src/config/productImages.js',import.meta.url), source = await readFile(imageModule,'utf8')
  const imports = new Map([...source.matchAll(/import (\w+) from '([^']+)'/g)].map(match=>[match[1],new URL(match[2],imageModule)]))
  const aliases = {Elegence:'elegence',Short:'elegence-short','Lovie Floral Dress':'lovi-floral'}
  const products=[]
  for (const product of saved.publicProducts) {
    const originalId=aliases[product.name];if(!originalId)continue
    const bundled=original.find(row=>row.id===originalId), config=getSizeConfig(originalId)
    const block=source.match(new RegExp(`(?:'${originalId}'|${originalId}): \\[([\\s\\S]*?)\\],`))?.[1]
    if(!block||!bundled||!config)throw Error('Original product presentation is missing.')
    const images=[]
    for(const match of block.matchAll(/image\('([^']+)',\s*(\w+),\s*'([^']+)'\)/g)) {
      const asset=imports.get(match[2]);if(!asset)throw Error('Original image import is missing.')
      const bytes=await readFile(asset)
      if(bytes.length>5*1024*1024||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')throw Error('Original image must meet the retained WebP upload contract.')
      images.push({id:match[1],file:fileURLToPath(asset),color:match[3],sha256:createHash('sha256').update(bytes).digest('hex')})
    }
    const fields=[{key:'bust',label:'ရင်',unit:'in'},{key:'waist',label:'ခါး',unit:'in'},{key:'hip',label:'တင်',unit:'in'},{key:'weight',label:'ကိုယ်အလေးချိန်',unit:'lb'}]
    const variantSizes=[...new Set(product.variants.map(row=>row.size))]
    const sizes=config.type==='numbered'?Object.values(config.rules).map(rule=>({id:rule.label,...rule})).filter(row=>variantSizes.includes(row.id)):
      [{id:variantSizes[0],label:'Free Size',...(config.rules||{weight:config.weightRange})}]
    const guide={id:`original-${originalId}`,name:`${bundled.name} Size Guide`,fields:config.type==='free-weight-only'?fields.filter(row=>row.key==='weight'):fields,sizes,
      notes:config.type==='numbered'?`Height: ${config.rules['size-1'].height}`:'',image_path:null}
    if(!images.length||!sizes.length)throw Error('Original image/size mapping requires review.')
    products.push({id:product.id,mainName:product.name,originalId,description:bundled.description,images,guide})
  }
  return {products,inputHash:digest(products.map(product=>({...product,images:product.images.map(({file:_file,...image})=>image)}))),imageCount:products.reduce((sum,row)=>sum+row.images.length,0),
    unmatchedMain:saved.publicProducts.filter(row=>!aliases[row.name]).map(row=>row.name),
    unmatchedOriginal:original.filter(row=>!Object.values(aliases).includes(row.id)).map(row=>row.name),
    changesStock:false,changesOriginalUsers:false}
}

async function main() {
  const args=process.argv.slice(2), plan=await prepare()
  if(args.join(' ')==='--prepare') {await writeFile(planFile,JSON.stringify(plan,null,2)+'\n');console.log(JSON.stringify({products:plan.products.length,images:plan.imageCount,guides:plan.products.length,unmatchedMain:plan.unmatchedMain,unmatchedOriginal:plan.unmatchedOriginal,databaseWrites:false}));return}
  if(args.join(' ')!=='--run-live --restore-original-presentation')throw Error('Choose presentation preparation or its explicit restoration.')
  const approved=JSON.parse(await readFile(planFile,'utf8'));if(approved.inputHash!==plan.inputHash)throw Error('Original presentation changed since preparation.')
  const {credentialPath}=assertMainLocalStartup({args:['--run-live','--allow-sidecar-writes']})
  process.env.GOOGLE_APPLICATION_CREDENTIALS=credentialPath;process.env.GOOGLE_CLOUD_QUOTA_PROJECT='pos-shop-owner';process.env.METADATA_SERVER_DETECTION='none'
  const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url))
  const {initializeApp,applicationDefault,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore')
  const app=initializeApp({projectId:'pos-shop-owner',credential:applicationDefault()},'restore-original-presentation'),raw=getFirestore(app)
  try {
    const db=createMainSidecarFirestore(raw,{writesEnabled:true}),shop='belle-online',path=`onlineShopV2/${shop}`
    const bucket=await createLocalMediaBucket({root:fileURLToPath(new URL('../.local/main-media/',import.meta.url))}),images=createImageService({db,bucket,storageOrigin:'http://127.0.0.1:5003'})
    const job=db.doc(`${path}/presentation_import_jobs/original`)
    await db.runTransaction(async tx=>{const old=await tx.get(job);if(old.exists&&old.data().inputHash!==plan.inputHash)throw Error('A different presentation job exists.');if(!old.exists)tx.create(job,{inputHash:plan.inputHash,completed:[],uploads:{},created_at:new Date().toISOString()})})
    for(const product of plan.products) {
      const ref=db.doc(`${path}/products/${product.id}`), current=(await ref.get()).data(), progress=(await job.get()).data()
      if(progress.completed.includes(product.id))continue
      if(!current||current.name!==product.mainName)throw Error('Mapped product changed. Preserve its current content and review.')
      const restored=[]
      if(!(current.images||[]).length)for(const image of product.images) {
        const key=`${product.id}_${image.id}`, previous=(await job.get()).data().uploads[key]
        const uploaded=previous||await images.upload(shop,{parentId:product.id,bucket:'product-images',data:(await readFile(image.file)).toString('base64')})
        if(!previous)await db.runTransaction(async tx=>{const state=(await tx.get(job)).data();tx.update(job,{uploads:{...state.uploads,[key]:uploaded}})})
        const attachment=await images.inspect(shop,uploaded.path,'product-images',product.id);if(!attachment)throw Error('Saved upload needs review.')
        restored.push({attachment,value:{id:image.id,path:uploaded.path,src:uploaded.src,alt:`${product.mainName} — ${image.color}`,color:image.color,is_cover:restored.length===0,position:restored.length}})
      }
      await db.runTransaction(async tx=>{
        const [post,state,guide]=await Promise.all([tx.get(ref),tx.get(job),tx.get(db.doc(`${path}/size_guides/${product.guide.id}`))])
        await images.lockAttachments(tx,restored.map(row=>row.attachment))
        if(state.data().completed.includes(product.id))return
        const value=post.data();if(!value||value.name!==product.mainName)throw Error('Mapped product changed.')
        const updates={}
        if(!value.size_guide_id){if(!guide.exists)tx.create(db.doc(`${path}/size_guides/${product.guide.id}`),{...product.guide,shop_id:shop,created_at:new Date().toISOString()});updates.size_guide_id=product.guide.id}
        if(!(value.images||[]).length&&restored.length)updates.images=restored.map(row=>row.value)
        if(!value.description)updates.description=product.description
        if(Object.keys(updates).length)tx.update(ref,updates)
        tx.update(job,{completed:[...state.data().completed,product.id]})
      })
    }
    await writeFile(new URL('../docs/evidence/main-original-presentation-restored.json',import.meta.url),JSON.stringify({observedAt:new Date().toISOString(),products:plan.products.map(row=>row.mainName),imageCount:plan.imageCount,guides:plan.products.length,originalWrites:false,stockChanges:false,completed:(await job.get()).data().completed},null,2)+'\n')
    console.log(JSON.stringify({restored:true,products:plan.products.length,images:plan.imageCount,guides:plan.products.length}))
  } finally {await raw.terminate();await deleteApp(app)}
}
main().catch(error=>{console.error(`Original presentation stopped (${error.code||error.status||error.name}): ${error.message}`);process.exitCode=2})
