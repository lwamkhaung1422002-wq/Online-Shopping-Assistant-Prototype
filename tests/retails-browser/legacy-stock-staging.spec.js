import { test, expect } from '@playwright/test'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createShopApi } from '../../../BelleLocal POS app/functions/src/online-shop/api.js'
import { createPosCatalog } from '../../../BelleLocal POS app/functions/src/pos/catalog.js'
import { createShopStock } from '../../../BelleLocal POS app/functions/src/online-shop/stock.js'
import { normalizeProduct } from '../../../BelleLocal POS app/functions/src/online-shop/domain.js'

if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Staged Chrome acceptance requires isolated Firebase services.')
const require=createRequire(new URL('../../../BelleLocal POS app/functions/package.json',import.meta.url))
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
const app=initializeApp({projectId:'demo-belle-online'},'staging-chrome'),db=getFirestore(app),auth=getAuth(app)

test('Embedded larger opening survives a real committed stage with lost response, mobile reload and frozen retry before publishing stock once',async({page,request})=>{
 test.setTimeout(180000)
 const uid='stage-chrome-'+randomUUID(),shop=uid,email=uid+'@belle-demo.example',old=(name,key)=>db.doc(`users/${uid}/${name}/${key}`)
 await auth.createUser({uid,email,password:'Local-test-only-123!',displayName:'Fictional staged owner'})
 const batch=db.batch()
 for(let i=0;i<100;i++)batch.set(old('stocks','a'+String(i).padStart(3,'0')),{quantity:2,unitCost:i%2?300:100,date:'2026-07-01',type:'Elegence',size:'1',color:'Brown'})
 for(const [key,status,allocations]of [['reserved','reserved',[{stockBatchId:'a000',quantity:1,unitCost:100}]],['completed','completed',[]]])batch.set(old('orders',key),{date:'2026-07-23',total:500,paymentStatus:'unpaid',fulfillmentStatus:status,items:[{quantity:1,unitPrice:500,unitCost:100,type:'Elegence',size:'1',color:'Brown',allocations}]})
 await batch.commit()
 const original=async()=>Object.fromEntries(await Promise.all(['stocks','orders'].map(async name=>[name,(await db.collection(`users/${uid}/${name}`).get()).docs.map(doc=>[doc.id,doc.data()])])))
 const before=await original(),product=await createPosCatalog({db}).create(shop,{name:'Actual larger opening target',price:500,cost:100,units:[{name:'Piece',isBase:true,conversionFactor:1}]},uid,randomUUID())
 const publicProduct=normalizeProduct({name:'Large original stock design',slug:uid,status:'published',variants:[{sku:uid,size:'1',color:'Brown',price:500,active:true}]},null,shop)
 await db.doc(`onlineShopV2/${shop}/products/${publicProduct.id}`).set(publicProduct)
 await createShopStock({db}).bind(shop,{public_product_id:publicProduct.id,public_variant_id:publicProduct.variants[0].id,pos_product_id:product.id},uid)
 const handler=createShopApi({db,auth,ownerUid:uid,allowedShopId:shop,legacyOpeningEnabled:true,allowedOrigins:['http://127.0.0.1:5177']})
 let lostResponse=false;const requests=[]
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');req.path=url.pathname;req.query=Object.fromEntries(url.searchParams);let raw='';for await(const chunk of req)raw+=chunk;req.body=raw?JSON.parse(raw):undefined
  if(req.method==='POST'&&req.path.endsWith('/admin/stock/legacy-opening'))requests.push({key:req.headers['idempotency-key'],body:req.body})
  res.set=(key,value)=>res.setHeader(key,value);res.status=value=>{res.statusCode=value;return res};res.send=value=>res.end(value)
  res.json=value=>{
   // Only transport delivery is interrupted, after the real API has committed.
   // No Firebase response, receipt or opening state is mocked.
   if(!lostResponse&&value.status==='STAGING'){lostResponse=true;res.statusCode=503;value={error:'Simulated local connection interruption after committed stock stage.'}}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))
  }
  await handler(req,res)
 })
 server.listen(0,'127.0.0.1');await once(server,'listening');const api=`http://127.0.0.1:${server.address().port}`
 const vite=spawn(process.execPath,[fileURLToPath(new URL('../../../BelleLocal POS app/node_modules/vite/bin/vite.js',import.meta.url)),'--host','127.0.0.1','--port','5177','--strictPort','--no-open'],{cwd:fileURLToPath(new URL('../../../BelleLocal POS app/',import.meta.url)),windowsHide:true,stdio:'ignore',env:{...process.env,VITE_POS_V2:'true',VITE_FIREBASE_DEMO_PROJECT:'demo-belle-online',VITE_SHOP_ID:shop,VITE_FIREBASE_API_URL:api}})
 try{
  await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:5177')).status}catch{return 0}},{timeout:30000}).toBe(200)
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:1365,height:950});await page.goto('http://127.0.0.1:5177/#/history')
  await page.getByRole('textbox',{name:'Email',exact:true}).fill(email);await page.getByRole('textbox',{name:'Password',exact:true}).fill('Local-test-only-123!');await page.getByRole('button',{name:/Sign in|Login/i}).click()
  await page.getByRole('button',{name:'Review shared stock opening',exact:true}).click();await expect(page.getByText('1 · Brown · Elegence · 198 available',{exact:true})).toBeVisible({timeout:30000})
  await page.getByRole('combobox',{name:'POS product for 1__Brown__Elegence',exact:true}).click();await page.getByRole('option',{name:product.name,exact:true}).click()
  await page.getByRole('button',{name:'Activate shared stock',exact:true}).click()
  const retry=page.getByRole('button',{name:'Retry stock activation',exact:true});await expect(retry).toBeEnabled({timeout:30000})
  await expect(page.getByRole('alert').filter({hasText:'Preparing shared stock: 50 of 99 batches.'})).toBeVisible()
  const interim=await db.doc(`onlineShopV2/${shop}/legacy_stock_baselines/main`).get();expect(interim.data().status).toBe('STAGING');expect(interim.data().prepared_batches).toBe(50)
  const blocked=await request.get(`${api}/${shop}/catalog`);expect(blocked.status()).toBe(409)
  expect(await original()).toEqual(before);await page.screenshot({path:'docs/screenshots/legacy-stock-staging-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844});await page.reload();await page.getByRole('button',{name:'Review shared stock opening',exact:true}).click()
  await expect(retry).toBeEnabled({timeout:30000});await expect(page.getByRole('combobox',{name:'POS product for 1__Brown__Elegence',exact:true})).toContainText(product.name)
  await expect(page.getByRole('alert').filter({hasText:'Preparing shared stock: 50 of 99 batches.'})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:'docs/screenshots/legacy-stock-staging-mobile.png',fullPage:true})
  await retry.click();await expect(page.getByRole('alert').filter({hasText:'Shared stock opening recorded: 198 available units.'})).toBeVisible({timeout:45000})
  await expect(page.getByRole('button',{name:'Activate shared stock',exact:true})).toBeDisabled()
  expect(new Set(requests.map(value=>value.key)).size).toBe(1);expect(requests.length).toBeGreaterThanOrEqual(3);expect(requests.every(value=>JSON.stringify(value.body)===JSON.stringify(requests[0].body))).toBeTruthy()
  expect((await db.collection(`onlineShopV2/${shop}/stock_batches`).get()).size).toBe(99);expect((await db.collection(`onlineShopV2/${shop}/stock_requests`).get()).size).toBe(99)
  const catalogue=await request.get(`${api}/${shop}/catalog`);expect(catalogue.status()).toBe(200);const publicData=await catalogue.json();expect(publicData[0].variants[0].available).toBe(198);expect(JSON.stringify(publicData)).not.toContain('unitCost');expect(JSON.stringify(publicData)).not.toContain('sourceHash')
  const login=await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{data:{email,password:'Local-test-only-123!',returnSecureToken:true}});expect(login.status()).toBe(200)
  const headers={Authorization:'Bearer '+(await login.json()).idToken,'Idempotency-Key':randomUUID()}
  const sold=await request.post(`${api}/${shop}/admin/pos/orders/checkout`,{headers,data:{saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{amount:500,method:'Cash'},items:[{productId:product.id,quantity:1}]}});expect(sold.status(),await sold.text()).toBe(201)
  const owner=await request.get(`${api}/${shop}/admin/pos/products/${product.id}`,{headers});expect(owner.status()).toBe(200);const ownerProduct=(await owner.json()).product;expect(ownerProduct.cost).toBe(200);expect(ownerProduct.availableStock).toBe(197);expect(ownerProduct.currentStock).toBe(198)
  await page.goto('http://127.0.0.1:5177/#/stock');await expect(page.getByText('198 Piece',{exact:true})).toBeVisible({timeout:30000});await page.screenshot({path:'docs/screenshots/legacy-stock-staging-inventory-mobile.png',fullPage:true})
  expect(await original()).toEqual(before);expect(errors).toEqual([])
 }finally{
  await page.close();if(vite.exitCode===null&&vite.signalCode===null){const exited=once(vite,'exit');vite.kill();await exited}
  await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections()})
 }
})
