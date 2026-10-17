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

if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Stock opening Chrome requires isolated Firebase services.')
const require=createRequire(new URL('../../../BelleLocal POS app/functions/package.json',import.meta.url)),{initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
const app=initializeApp({projectId:'demo-belle-online'},'legacy-stock-chrome'),db=getFirestore(app),auth=getAuth(app)

for(const mode of ['free-pool','zero-free','fractional'])test(`Embedded Belle ${mode} stock review preserves original reservations, valuation and actual POS/public quantities on desktop/mobile`,async({page,request})=>{
 const zeroFree=mode==='zero-free',fractional=mode==='fractional'
 test.setTimeout(150000)
 const uid='stock-chrome-'+randomUUID(),shop=uid,email=uid+'@belle-demo.example',old=(name,key)=>db.doc(`users/${uid}/${name}/${key}`)
 await auth.createUser({uid,email,password:'Local-test-only-123!',displayName:'Fictional stock owner'})
 await old('stocks','source-a').set({date:'2026-07-01',quantity:3,unitCost:100,type:'Elegence',size:'1',color:'Brown'})
 await old('stocks','source-b').set({date:'2026-07-01',quantity:3,unitCost:300,type:'Elegence',size:'1',color:'Brown'})
 const originalQuantity=zeroFree?3:fractional?1.5:1,granted=zeroFree?0:fractional?3:4,availableAfterSale=zeroFree?0:fractional?2.5:2,physicalAfterSale=fractional?4:3,saleQuantity=fractional?0.5:2
 for(const [key,status,allocations]of [['reserved','reserved',[{stockBatchId:'source-a',quantity:originalQuantity,unitCost:100}]],['completed','completed',[]]])await old('orders',key).set({date:'2026-07-23',total:500*originalQuantity,paymentStatus:'unpaid',fulfillmentStatus:status,items:[{type:'Elegence',size:'1',color:'Brown',quantity:originalQuantity,unitPrice:500,unitCost:100,allocations}]})
 const original=async()=>Object.fromEntries(await Promise.all(['stocks','orders'].map(async name=>[name,(await db.collection(`users/${uid}/${name}`).get()).docs.map(doc=>[doc.id,doc.data()])])))
 const before=await original(),product=await createPosCatalog({db}).create(shop,{name:'Reviewed original stock target',cost:100,price:500,units:[{name:'Piece',isBase:true,conversionFactor:1}]},uid,randomUUID())
 const publicProduct=normalizeProduct({name:'Elegence shared stock',slug:'shared-'+randomUUID(),status:'published',variants:[{sku:'Original pool',size:'1',color:'Brown',price:500,active:true}]},null,shop)
 await db.doc(`onlineShopV2/${shop}/products/${publicProduct.id}`).set(publicProduct)
 await createShopStock({db}).bind(shop,{public_product_id:publicProduct.id,public_variant_id:publicProduct.variants[0].id,pos_product_id:product.id},uid)
 // The local read-only-original rules were verified with actual owner tokens.
 // A clean test API enables only this fictional shop; production flags and
 // the current shared Functions configuration remain unchanged.
 const handler=createShopApi({db,auth,ownerUid:uid,allowedShopId:shop,legacyOpeningEnabled:true,allowedOrigins:['http://127.0.0.1:5177']})
 const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');req.path=url.pathname;req.query=Object.fromEntries(url.searchParams);let raw='';for await(const chunk of req)raw+=chunk;req.body=raw?JSON.parse(raw):undefined;res.set=(key,value)=>res.setHeader(key,value);res.status=value=>{res.statusCode=value;return res};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))};res.send=value=>res.end(value);await handler(req,res)})
 server.listen(0,'127.0.0.1');await once(server,'listening');const api=`http://127.0.0.1:${server.address().port}`
 const vite=spawn(process.execPath,[fileURLToPath(new URL('../../../BelleLocal POS app/node_modules/vite/bin/vite.js',import.meta.url)),'--host','127.0.0.1','--port','5177','--strictPort','--no-open'],{cwd:fileURLToPath(new URL('../../../BelleLocal POS app/',import.meta.url)),windowsHide:true,stdio:'ignore',env:{...process.env,VITE_POS_V2:'true',VITE_FIREBASE_DEMO_PROJECT:'demo-belle-online',VITE_SHOP_ID:shop,VITE_FIREBASE_API_URL:api}})
 try{
  await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:5177')).status}catch{return 0}},{timeout:30000}).toBe(200)
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:1365,height:950});await page.goto('http://127.0.0.1:5177/#/history')
  await page.getByRole('textbox',{name:'Email',exact:true}).fill(email);await page.getByRole('textbox',{name:'Password',exact:true}).fill('Local-test-only-123!');await page.getByRole('button',{name:/Sign in|Login/i}).click()
  await page.getByRole('button',{name:'Review shared stock opening',exact:true}).click()
  await expect(page.getByText(`1 · Brown · Elegence · ${granted} available`,{exact:true})).toBeVisible({timeout:30000})
  const activate=page.getByRole('button',{name:'Activate shared stock',exact:true});await expect(activate).toBeDisabled()
  await page.getByRole('combobox',{name:'POS product for 1__Brown__Elegence',exact:true}).click();await page.getByRole('option',{name:product.name,exact:true}).click();await expect(activate).toBeEnabled()
  const activated=page.waitForResponse(response=>response.url().endsWith('/admin/stock/legacy-opening')&&response.request().method()==='POST')
  await activate.click();expect((await activated).status()).toBe(200);await expect(page.getByRole('alert').filter({hasText:`Shared stock opening recorded: ${granted} available units.`})).toBeVisible();await expect(activate).toBeDisabled()
  await page.screenshot({path:`docs/screenshots/${fractional?'legacy-fractional-opening':zeroFree?'legacy-zero-free-opening':'legacy-stock-opening'}-desktop.png`,fullPage:true})
  const login=await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{data:{email,password:'Local-test-only-123!',returnSecureToken:true}});expect(login.status()).toBe(200);const headers={Authorization:'Bearer '+(await login.json()).idToken,'Idempotency-Key':randomUUID()}
  const sold=await request.post(`${api}/${shop}/admin/pos/orders/checkout`,{headers,data:{saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{amount:saleQuantity*500,method:'Cash'},items:[{productId:product.id,quantity:saleQuantity}]}})
  if(zeroFree)expect([400,409]).toContain(sold.status());else expect(sold.status(),await sold.text()).toBe(201)
  const catalogue=await request.get(`${api}/${shop}/catalog`);expect(catalogue.status()).toBe(200);const publicData=await catalogue.json();expect(publicData[0].variants[0].available).toBe(Math.floor(availableAfterSale));expect(JSON.stringify(publicData)).not.toContain('legacySource');expect(JSON.stringify(publicData)).not.toContain('unitCost')
  const ownerInventory=await request.get(`${api}/${shop}/admin/pos/products/${product.id}`,{headers});expect(ownerInventory.status()).toBe(200);const ownerProduct=(await ownerInventory.json()).product
  expect(ownerProduct.currentStock).toBe(physicalAfterSale);expect(ownerProduct.availableStock).toBe(availableAfterSale);expect(ownerProduct.cost).toBe(200)
  const reportResponse=await request.get(`${api}/${shop}/admin/pos/product-report`,{headers});expect(reportResponse.status()).toBe(200);const reportProduct=(await reportResponse.json()).products.find(value=>value.id===product.id);expect(reportProduct.currentStock).toBe(physicalAfterSale);expect(reportProduct.stockValue).toBe(physicalAfterSale*200)
  await page.goto('http://127.0.0.1:5177/#/stock');await expect(page.getByText(`${physicalAfterSale} Piece`,{exact:true})).toBeVisible({timeout:30000})
  await page.screenshot({path:`docs/screenshots/${fractional?'legacy-fractional-inventory':zeroFree?'legacy-zero-free-inventory':'legacy-inventory'}-desktop.png`,fullPage:true})
  const completed=await request.post(`${api}/${shop}/admin/history/orders/reserved/events`,{headers,data:{action:'complete',request_key:randomUUID()}});expect(completed.status(),await completed.text()).toBe(200)
  await page.setViewportSize({width:390,height:844});await page.reload();await expect(page.getByText(`${availableAfterSale} Piece`,{exact:true})).toBeVisible({timeout:30000})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:`docs/screenshots/${fractional?'legacy-fractional-inventory':zeroFree?'legacy-zero-free-inventory':'legacy-inventory'}-mobile.png`,fullPage:true})
  const afterCompletion=await request.get(`${api}/${shop}/catalog`);expect((await afterCompletion.json())[0].variants[0].available).toBe(Math.floor(availableAfterSale))
  await page.goto('http://127.0.0.1:5177/#/history')
  await page.setViewportSize({width:390,height:844});await page.reload();await page.getByRole('button',{name:'Review shared stock opening',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:`Shared stock opening recorded: ${granted} available units.`})).toBeVisible({timeout:30000});await expect(activate).toBeDisabled()
  await expect(page.getByRole('combobox',{name:'POS product for 1__Brown__Elegence',exact:true})).toContainText(product.name)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:`docs/screenshots/${fractional?'legacy-fractional-opening':zeroFree?'legacy-zero-free-opening':'legacy-stock-opening'}-mobile.png`,fullPage:true});expect(await original()).toEqual(before);expect(errors).toEqual([])
 }finally{await page.close();if(vite.exitCode===null&&vite.signalCode===null){const exited=once(vite,'exit');vite.kill();await exited}await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections()})}
})
