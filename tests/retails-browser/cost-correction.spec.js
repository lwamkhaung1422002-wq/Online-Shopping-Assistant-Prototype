import {test,expect} from '@playwright/test'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createShopApi} from '../../../BelleLocal POS app/functions/src/online-shop/api.js'
import {createPosCatalog} from '../../../BelleLocal POS app/functions/src/pos/catalog.js'
import {createPosOrders} from '../../../BelleLocal POS app/functions/src/pos/orders.js'
import {createStockLedger,stockScopeKey} from '../../../BelleLocal POS app/functions/src/pos/stock-ledger.js'

if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Cost correction Chrome requires isolated Firebase services.')
const require=createRequire(new URL('../../../BelleLocal POS app/functions/package.json',import.meta.url)),{initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
const app=initializeApp({projectId:'demo-belle-online'},'cost-correction-chrome'),db=getFirestore(app),auth=getAuth(app)

test('Retained desktop GROUP and mobile ALL cost correction persist sold/remaining valuation, saved invoices and source audit history after reload',async({page})=>{
 test.setTimeout(150000)
 const uid='cost-chrome-'+randomUUID(),shop=uid,email=uid+'@belle-demo.example',name='Chrome cost root',table=key=>db.collection(`onlineShopV2/${shop}/${key}`)
 await auth.createUser({uid,email,password:'Local-test-only-123!',displayName:'Chrome cost owner'})
 const originalUid=uid+'-original',oldNames=['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta'],source={status:'reserved',amount:34500,quantity:2},originals=async()=>Object.fromEntries(await Promise.all(oldNames.map(async key=>[key,(await db.doc(`users/${originalUid}/${key}/original`).get()).data()])))
 for(const key of oldNames)await db.doc(`users/${originalUid}/${key}/original`).set(source)
 const before=await originals(),catalog=createPosCatalog({db}),product=await catalog.create(shop,{name,price:1000,cost:500,units:[{name:'Piece',isBase:true,conversionFactor:1}],openingStock:{quantity:5,unitCost:500,receivedAt:'2026-10-01T03:00:00.000Z'}},uid,randomUUID()),ledger=createStockLedger({db})
 await ledger.receive(shop,{productId:product.id,quantity:5,unitCost:700,receivedAt:'2026-10-02T03:00:00.000Z'},uid,randomUUID());const sold=await createPosOrders({db}).create(shop,{saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{method:'Cash',amount:4000},items:[{productId:product.id,quantity:4}]},uid,randomUUID(),{checkout:true}),movementsBefore=(await table('stock_movements').get()).docs.map(row=>row.data()),paymentsBefore=(await table('pos_payments').get()).docs.map(row=>row.data())
 const handler=createShopApi({db,auth,ownerUid:uid,allowedShopId:shop,allowedOrigins:['http://127.0.0.1:5177']})
 const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');req.path=url.pathname;req.query=Object.fromEntries(url.searchParams);let raw='';for await(const chunk of req)raw+=chunk;req.body=raw?JSON.parse(raw):undefined;res.set=(key,value)=>res.setHeader(key,value);res.status=value=>{res.statusCode=value;return res};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))};res.send=value=>res.end(value);await handler(req,res)})
 server.listen(0,'127.0.0.1');await once(server,'listening');const api=`http://127.0.0.1:${server.address().port}`
 const vite=spawn(process.execPath,[fileURLToPath(new URL('../../../BelleLocal POS app/node_modules/vite/bin/vite.js',import.meta.url)),'--host','127.0.0.1','--port','5177','--strictPort','--no-open'],{cwd:fileURLToPath(new URL('../../../BelleLocal POS app/',import.meta.url)),windowsHide:true,stdio:'ignore',env:{...process.env,VITE_POS_V2:'true',VITE_FIREBASE_DEMO_PROJECT:'demo-belle-online',VITE_SHOP_ID:shop,VITE_FIREBASE_API_URL:api}})


 try{
  await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:5177')).status}catch{return 0}},{timeout:30000}).toBe(200)
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(20000);await page.setViewportSize({width:1365,height:950});const editUrl='http://127.0.0.1:5177/#/stock/add?edit='+product.id;await page.goto(editUrl)
  await page.getByRole('textbox',{name:'Email',exact:true}).fill(email);await page.getByRole('textbox',{name:'Password',exact:true}).fill('Local-test-only-123!');await page.getByRole('button',{name:/Sign in|Login/i}).click()
  const field=label=>page.getByText(label,{exact:true}).locator('../..').getByRole('textbox');await page.getByRole('combobox',{name:'Cost Price',exact:true}).click();await page.getByRole('option',{name:/^500.*Stock 1.*Sold 4/}).click();await field('New Cost Price').fill('600');await page.getByRole('textbox',{name:'Reason',exact:true}).fill('Chrome group correction');await expect(page.getByText('Affects 1 remaining and 4 sold. Sold costs and profit will be recalculated.',{exact:true})).toBeVisible();await page.screenshot({path:'docs/screenshots/cost-correction-desktop.png',fullPage:true})
  const pending=page.waitForResponse(response=>response.url().endsWith('/products/'+product.id)&&response.request().method()==='PATCH');await page.getByRole('button',{name:'Save Changes',exact:true}).click();const response=await pending;expect(response.status()).toBe(200);expect((await response.json()).product.cost).toBe(683);await expect(page).toHaveURL(new RegExp('#/stock/'+product.id+'$'));expect((await table('pos_orders').doc(sold.order.id).get()).data().items[0].unitCost).toBe(600);expect((await table('stock_balances').doc(stockScopeKey(product.id)).get()).data().onHand).toBe('6')
  await page.setViewportSize({width:390,height:844});await page.goto(editUrl);await page.reload();await page.getByRole('combobox',{name:'Cost Price',exact:true}).click();await page.getByRole('option',{name:'All Cost Prices',exact:true}).click();await field('New Cost Price').fill('800');await page.getByRole('textbox',{name:'Reason',exact:true}).fill('Chrome all group correction');await expect(page.getByText('Affects 6 remaining and 4 sold. Sold costs and profit will be recalculated.',{exact:true})).toBeVisible();await page.screenshot({path:'docs/screenshots/cost-correction-mobile.png',fullPage:true});const again=page.waitForResponse(response=>response.url().endsWith('/products/'+product.id)&&response.request().method()==='PATCH');await page.getByRole('button',{name:'Save Changes',exact:true}).click();expect((await again).status()).toBe(200);await expect(page).toHaveURL(new RegExp('#/stock/'+product.id+'$'));await page.reload();expect((await table('pos_products').doc(product.id).get()).data().cost).toBe(800);expect((await table('pos_orders').doc(sold.order.id).get()).data().items[0].unitCost).toBe(800)
  await page.getByRole('button',{name:'View cost price history',exact:true}).click();await expect(page.getByText('Cost Price History',{exact:true})).toBeVisible();await expect(page.getByText('Cost Price Edit',{exact:true})).toHaveCount(2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();expect((await table('stock_movements').get()).docs.map(row=>row.data())).toEqual(movementsBefore);expect((await table('pos_payments').get()).docs.map(row=>row.data())).toEqual(paymentsBefore);expect(await originals()).toEqual(before);expect(errors).toEqual([])
 }finally{await page.close();if(vite.exitCode===null&&vite.signalCode===null){const exited=once(vite,'exit');vite.kill();await exited}await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections()})}
})

