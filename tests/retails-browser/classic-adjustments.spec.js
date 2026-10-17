import {test,expect} from '@playwright/test'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createShopApi} from '../../../BelleLocal POS app/functions/src/online-shop/api.js'
import {createPosCatalog} from '../../../BelleLocal POS app/functions/src/pos/catalog.js'
import {createStockLedger,stockScopeKey} from '../../../BelleLocal POS app/functions/src/pos/stock-ledger.js'
import {createShopStock} from '../../../BelleLocal POS app/functions/src/online-shop/stock.js'
import {normalizeProduct} from '../../../BelleLocal POS app/functions/src/online-shop/domain.js'

if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Classic adjustment Chrome requires isolated Firebase services.')
const require=createRequire(new URL('../../../BelleLocal POS app/functions/package.json',import.meta.url)),{initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
const app=initializeApp({projectId:'demo-belle-online'},'classic-adjustment-chrome'),db=getFirestore(app),auth=getAuth(app)

test('Retained desktop decrease and mobile increase persist actual Firebase stock/cost/history, reject held-stock shortage and preserve original records after reload',async({page})=>{
 test.setTimeout(150000)
 const uid='classic-chrome-'+randomUUID(),shop=uid,email=uid+'@belle-demo.example',name='Chrome counted stock',table=key=>db.collection(`onlineShopV2/${shop}/${key}`)
 await auth.createUser({uid,email,password:'Local-test-only-123!',displayName:'Chrome stock owner'})
 const oldNames=['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta'],source={status:'reserved',amount:34500,quantity:2},originals=async()=>Object.fromEntries(await Promise.all(oldNames.map(async key=>[key,(await db.doc(`users/${uid}/${key}/original`).get()).data()])))
 for(const key of oldNames)await db.doc(`users/${uid}/${key}/original`).set(source)
 const before=await originals(),product=await createPosCatalog({db}).create(shop,{name,price:500,cost:100,units:[{name:'Piece',isBase:true,conversionFactor:1}],openingStock:{quantity:5,unitCost:100,receivedAt:'2026-10-01T03:00:00.000Z'}},uid,randomUUID()),ledger=createStockLedger({db})
 await ledger.receive(shop,{productId:product.id,quantity:2,unitCost:200,receivedAt:'2026-10-02T03:00:00.000Z'},uid,randomUUID());await ledger.reservation(shop,{productId:product.id,sourceType:'PosOrder',sourceId:randomUUID(),quantity:1},uid,randomUUID())
 const publicProduct=normalizeProduct({name:'Adjusted public stock',slug:'adjust-'+randomUUID(),status:'published',variants:[{sku:randomUUID(),color:'Brown',size:'One',price:500,active:true}]},null,shop),stock=createShopStock({db})
 await table('products').doc(publicProduct.id).set(publicProduct);await stock.bind(shop,{public_product_id:publicProduct.id,public_variant_id:publicProduct.variants[0].id,pos_product_id:product.id},uid)
 const handler=createShopApi({db,auth,ownerUid:uid,allowedShopId:shop,allowedOrigins:['http://127.0.0.1:5177']})
 const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');req.path=url.pathname;req.query=Object.fromEntries(url.searchParams);let raw='';for await(const chunk of req)raw+=chunk;req.body=raw?JSON.parse(raw):undefined;res.set=(key,value)=>res.setHeader(key,value);res.status=value=>{res.statusCode=value;return res};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))};res.send=value=>res.end(value);await handler(req,res)})
 server.listen(0,'127.0.0.1');await once(server,'listening');const api=`http://127.0.0.1:${server.address().port}`
 const vite=spawn(process.execPath,[fileURLToPath(new URL('../../../BelleLocal POS app/node_modules/vite/bin/vite.js',import.meta.url)),'--host','127.0.0.1','--port','5177','--strictPort','--no-open'],{cwd:fileURLToPath(new URL('../../../BelleLocal POS app/',import.meta.url)),windowsHide:true,stdio:'ignore',env:{...process.env,VITE_POS_V2:'true',VITE_FIREBASE_DEMO_PROJECT:'demo-belle-online',VITE_SHOP_ID:shop,VITE_FIREBASE_API_URL:api}})
 try{
  await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:5177')).status}catch{return 0}},{timeout:30000}).toBe(200)
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(20000);await page.setViewportSize({width:1365,height:950});await page.goto('http://127.0.0.1:5177/#/stock/movement/add')
  await page.getByRole('textbox',{name:'Email',exact:true}).fill(email);await page.getByRole('textbox',{name:'Password',exact:true}).fill('Local-test-only-123!');await page.getByRole('button',{name:/Sign in|Login/i}).click()
  const select=async()=>{await page.getByPlaceholder('Search product or enter barcode',{exact:true}).fill(name);await expect(page.getByText(/Current Stock:/)).toBeVisible();await page.getByRole('button',{name:/^(Stock )?Adjustment$/}).click()}
  const decrease=async(qty,reason)=>{await page.getByRole('button',{name:'Decrease',exact:true}).click();await page.getByRole('combobox',{name:/Cost Price/}).click();await page.getByRole('option',{name:/Cost 100.*Available/}).click();await page.getByRole('spinbutton',{name:/Quantity/}).fill(String(qty));await page.getByRole('textbox',{name:/Notes/}).fill(reason)}
  await select();await decrease(1.5,'Chrome missing stock count');await page.screenshot({path:'docs/screenshots/classic-adjustment-desktop.png',fullPage:true})
  const decreased=page.waitForResponse(response=>response.url().endsWith('/inventory/adjustments/by-cost')&&response.request().method()==='POST');await page.getByRole('button',{name:'Save Adjustment',exact:true}).click();const decreasedResponse=await decreased;expect(decreasedResponse.status()).toBe(201);expect((await decreasedResponse.json()).adjustment.baseQuantity).toBe('1.5');await expect(page).toHaveURL(/#\/stock$/)
  expect((await table('stock_balances').doc(stockScopeKey(product.id)).get()).data().onHand).toBe('5.5');expect((await table('pos_products').doc(product.id).get()).data().cost).toBe(136);expect((await stock.project(shop,[publicProduct]))[0].variants[0].available).toBe(4.5)
  await page.goto('http://127.0.0.1:5177/#/stock/history');await expect(page.getByText('Chrome missing stock count',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('Chrome missing stock count',{exact:true})).toBeVisible()
  await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:5177/#/stock/movement/add');await select();await page.getByRole('button',{name:'Increase',exact:true}).click();await page.getByRole('spinbutton',{name:/Quantity/}).fill('0.5');await page.getByRole('textbox',{name:/Notes/}).fill('Chrome found stock count');await page.screenshot({path:'docs/screenshots/classic-adjustment-mobile.png',fullPage:true})
  const increased=page.waitForResponse(response=>/\/inventory\/[^/]+\/adjustments$/.test(response.url())&&response.request().method()==='POST');await page.getByRole('button',{name:'Save Adjustment',exact:true}).click();const increasedResponse=await increased;expect(increasedResponse.status()).toBe(201);expect((await increasedResponse.json()).adjustment.action).toBe('ADD');await expect(page).toHaveURL(/#\/stock$/)
  expect((await table('stock_balances').doc(stockScopeKey(product.id)).get()).data().onHand).toBe('6');expect((await table('pos_products').doc(product.id).get()).data().cost).toBe(142);expect((await stock.project(shop,[publicProduct]))[0].variants[0].available).toBe(5)
  await page.goto('http://127.0.0.1:5177/#/stock/history');await page.reload();await expect(page.getByText('Chrome found stock count',{exact:true})).toBeVisible();await expect(page.getByText('Chrome missing stock count',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy()
  await page.goto('http://127.0.0.1:5177/#/stock/movement/add');await select();await decrease(3,'Must not spend the held unit');const rejected=page.waitForResponse(response=>response.url().endsWith('/inventory/adjustments/by-cost')&&response.request().method()==='POST');await page.getByRole('button',{name:'Save Adjustment',exact:true}).click();expect((await rejected).status()).toBe(409);await expect(page.getByText(/Insufficient stock at cost price 100/)).toBeVisible();expect((await table('pos_stock_adjustments').get()).size).toBe(2);expect((await table('stock_balances').doc(stockScopeKey(product.id)).get()).data().onHand).toBe('6')
  const records=(await table('pos_stock_adjustments').get()).docs.map(row=>row.data());expect(records.every(row=>row.staffName==='Chrome stock owner'&&row.unitSnapshot.name==='Piece')).toBeTruthy();expect(await originals()).toEqual(before);expect(errors).toEqual([])
 }finally{await page.close();if(vite.exitCode===null&&vite.signalCode===null){const exited=once(vite,'exit');vite.kill();await exited}await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections()})}
})
