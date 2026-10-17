import {existsSync} from 'node:fs'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'

// Authorized source-data inspection only. Never reuse a demo credential/runtime
// or expose document values in the report. This is not the app's write API.
const projectId='pos-shop-owner',ownerUid='UXRbRF184gcohMkl4CdS0i0rdow2'
const tables=['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta']
const target=new URL('../docs/evidence/main-firebase-readonly-sample.json',import.meta.url)
function fail(message){throw new Error(message)}
function credentialAvailable(){
  if(process.env.GOOGLE_APPLICATION_CREDENTIALS)return existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  const base=process.platform==='win32'?process.env.APPDATA:process.env.HOME&&join(process.env.HOME,'.config')
  return !!base&&existsSync(join(base,'gcloud','application_default_credentials.json'))
}
function fields(data,prefix='',depth=0,result={}){
  if(depth>4)return result
  for(const [key,value] of Object.entries(data)){
    const name=prefix?prefix+'.'+key:key
    const type=value===null?'null':Array.isArray(value)?'array':value instanceof Date?'date':value?.constructor?.name==='Timestamp'?'timestamp':typeof value
    result[name]??=new Set();result[name].add(type)
    if(type==='object'&&value?.constructor===Object)fields(value,name,depth+1,result)
    if(type==='array')for(const item of value.slice(0,3))if(item&&item.constructor===Object)fields(item,name+'[]',depth+1,result)
  }
  return result
}
async function main(){
  if(process.argv.length!==3||process.argv[2]!=='--run-live')fail('No database request made. Use --run-live only for authorized read-only source inspection.')
  if(process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_AUTH_EMULATOR_HOST||process.env.GCLOUD_PROJECT?.startsWith('demo-'))fail('No database request made. A demo/emulator environment cannot verify main Firebase data.')
  if(!credentialAvailable())fail('No database request made. Authorized Application Default Credentials are unavailable. Firebase Console or CLI login alone is not an Admin SDK credential.')
  process.env.METADATA_SERVER_DETECTION='none'
  const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url))
  const {initializeApp,applicationDefault,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore')
  const app=initializeApp({projectId,credential:applicationDefault()},'main-source-readonly'),db=getFirestore(app)
  try{
    const sample=await db.runTransaction(async tx=>{
      const collections=[]
      for(const table of tables){
        const rows=await tx.get(db.collection(`users/${ownerUid}/${table}`).limit(5)),shape={}
        for(const row of rows.docs)fields(row.data(),'',0,shape)
        collections.push({table,sampled_documents:rows.size,field_types:Object.fromEntries(Object.entries(shape).sort(([a],[b])=>a.localeCompare(b)).map(([key,types])=>[key,[...types].sort()]))})
      }
      // This is the exact source order previously provided by the user.
      const known=await tx.get(db.doc(`users/${ownerUid}/orders/QqCHl8BRInz67ZomN9jY`))
      return {collections,provided_order_exists:known.exists}
    },{readOnly:true})
    const report={observed_at:new Date().toISOString(),project_id:projectId,owner_uid:ownerUid,scope:'Original source schema sample in a server-enforced read-only transaction. No values, totals, customer identities, credentials or writes. Not complete data/API/account parity.',...sample}
    await writeFile(target,JSON.stringify(report,null,2)+'\n')
    console.log(JSON.stringify({project_id:projectId,provided_order_exists:sample.provided_order_exists,sampled_documents:sample.collections.reduce((count,row)=>count+row.sampled_documents,0),report:fileURLToPath(target)}))
  }finally{await db.terminate();await deleteApp(app)}
}
main().catch(error=>{console.error(error.message.startsWith('No database request made.')?error.message:`Read-only source inspection failed (${error.code||error.name||'unknown'}). No successful connection is claimed.`);process.exitCode=2})
