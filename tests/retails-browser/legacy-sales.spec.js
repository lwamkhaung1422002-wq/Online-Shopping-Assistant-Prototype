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

if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Sales source Chrome requires isolated Firebase services.')
const require=createRequire(new URL('../../../BelleLocal POS app/functions/package.json',import.meta.url)),{initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth')
const app=initializeApp({projectId:'demo-belle-online'},'sales-source-chrome'),db=getFirestore(app),auth=getAuth(app)
test.afterAll(async()=>{await db.terminate();await deleteApp(app)})

test('Main Sales uses original sale dates and costs, refreshes collections after real continuation, opens source history and survives mobile reload',async({page})=>{
 test.setTimeout(180000)
 const uid='sales-chrome-'+randomUUID(),shop=uid,email=uid+'@belle-demo.example',old=(name,key)=>db.doc(`users/${uid}/${name}/${key}`),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Yangon',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
 await auth.createUser({uid,email,password:'Local-test-only-123!'})
 const legacy=(total,cost,paid)=>({date:day,total,amountPaid:paid?total:0,balanceDue:paid?0:total,paymentStatus:paid?'paid':'unpaid',fulfillmentStatus:'reserved',customer:{name:'Original Sales buyer'},items:[{type:'Original design',quantity:1,unitPrice:total,unitCost:cost}],...(paid?{paymentId:'paid-receipt',paymentIds:['paid-receipt']}:{})})
 await old('orders','paid').set(legacy(500,100,true));await old('orders','unpaid').set({...legacy(300,80,false),date:'2026-07-23'});await old('payments','paid-receipt').set({orderId:'paid',date:day,amount:500,method:'KBZ Pay 1',transactionId:'330000'})
 const originals=async()=>Object.fromEntries(await Promise.all(['orders','payments'].map(async name=>[name,(await db.collection(`users/${uid}/${name}`).get()).docs.map(doc=>[doc.id,doc.data()])])))
 const before=await originals(),product=await createPosCatalog({db}).create(shop,{name:'Actual Sales report producer',price:1000,cost:200,units:[{name:'Piece',isBase:true,conversionFactor:1}],openingStock:{quantity:3,unitCost:200}},uid,randomUUID())
 const invoice=await createPosOrders({db}).create(shop,{saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{amount:1000,method:'Cash'},items:[{productId:product.id,quantity:1}]},uid,randomUUID(),{checkout:true})
 const handler=createShopApi({db,auth,ownerUid:uid,allowedShopId:shop,allowedOrigins:['http://127.0.0.1:5177']})
 const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');req.path=url.pathname;req.query=Object.fromEntries(url.searchParams);let raw='';for await(const chunk of req)raw+=chunk;req.body=raw?JSON.parse(raw):undefined;res.set=(key,value)=>res.setHeader(key,value);res.status=value=>{res.statusCode=value;return res};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))};res.send=value=>res.end(value);await handler(req,res)})
 server.listen(0,'127.0.0.1');await once(server,'listening');const api=`http://127.0.0.1:${server.address().port}`
 const vite=spawn(process.execPath,[fileURLToPath(new URL('../../../BelleLocal POS app/node_modules/vite/bin/vite.js',import.meta.url)),'--host','127.0.0.1','--port','5177','--strictPort','--no-open'],{cwd:fileURLToPath(new URL('../../../BelleLocal POS app/',import.meta.url)),windowsHide:true,stdio:'ignore',env:{...process.env,VITE_POS_V2:'true',VITE_FIREBASE_DEMO_PROJECT:'demo-belle-online',VITE_SHOP_ID:shop,VITE_FIREBASE_API_URL:api}})
 try{
  await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:5177')).status}catch{return 0}},{timeout:30000}).toBe(200)
  const errors=[];page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:1365,height:950});await page.goto('http://127.0.0.1:5177/#/report/sales')
  await page.getByRole('textbox',{name:'Email',exact:true}).fill(email);await page.getByRole('textbox',{name:'Password',exact:true}).fill('Local-test-only-123!');await page.getByRole('button',{name:/Sign in|Login/i}).click()
  const metric=label=>page.getByText(label,{exact:true}).first().locator('../..'),assertMetrics=async(sales,cost,profit)=>{for(const [label,value]of [['Total Sales',sales],['Total Cost Price',cost],['Profit',profit]])await expect(metric(label)).toContainText(Number(value).toLocaleString('en-US'),{timeout:30000})}
  await assertMetrics(1500,300,1200);await expect(page.getByText('Belle history and new POS',{exact:true})).toBeVisible()
  const details=async()=>{const summary=page.getByText('Historical sales details',{exact:true});if(await summary.locator('..').getAttribute('open')===null)await summary.click()}
  await details();await expect(page.getByRole('link',{name:'POS '+invoice.order.id,exact:true})).toHaveAttribute('href','#/sale/'+invoice.order.id)
  await page.getByRole('link',{name:'Belle paid',exact:true}).click();await expect(page.getByRole('dialog',{name:/Historical order.*paid/})).toBeVisible();await page.getByRole('button',{name:'Close',exact:true}).click()
  const receive=async(amount,reference)=>{
   await page.getByRole('row').filter({hasText:'unpaid'}).filter({has:page.getByRole('button',{name:'View history'})}).getByRole('button',{name:'View history'}).click()
   await page.getByRole('button',{name:'Receive payment',exact:true}).click();const payment=page.getByRole('dialog',{name:'Receive payment',exact:true});await payment.getByRole('spinbutton',{name:'Amount',exact:true}).fill(String(amount));await payment.getByLabel('Transaction ID (6 digits)').fill(reference);await payment.getByRole('button',{name:'Confirm',exact:true}).click();await expect(payment).not.toBeVisible();await page.getByRole('button',{name:'Close',exact:true}).click()
   const refreshed=page.waitForResponse(response=>response.url().includes('/admin/pos/reports/sales?')&&response.request().method()==='GET',{timeout:30000});await page.goto('http://127.0.0.1:5177/#/report/sales');expect((await refreshed).status()).toBe(200);await assertMetrics(1500,300,1200);await details()
  }
  await receive(100,'330001');await expect(page.getByText('Historical outstanding, all dates: 200 K',{exact:true})).toBeVisible();await expect(page.getByText('Historical collections in this period: 600 K · Refunds: 0 K',{exact:true})).toBeVisible()
  await page.getByRole('link',{name:'Review original history',exact:true}).click();await receive(200,'330002');await expect(page.getByText('Historical outstanding, all dates: 0 K',{exact:true})).toBeVisible();await expect(page.getByText('Historical collections in this period: 800 K · Refunds: 0 K',{exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Belle unpaid',exact:true})).toHaveCount(0)
  // Final payment stays on its receipt date; recognition stays on July 23.
  await page.getByRole('button').filter({has:page.locator('[data-testid="CalendarMonthRoundedIcon"]')}).click();const dialog=page.getByRole('dialog',{name:'Filter sale report'});await dialog.getByRole('button',{name:'Custom',exact:true}).click();await dialog.getByLabel('From',{exact:true}).fill('2026-07-23');await dialog.getByLabel('To',{exact:true}).fill('2026-07-23');await dialog.getByRole('button',{name:'Apply',exact:true}).click();await assertMetrics(300,80,220);await details();await expect(page.getByRole('link',{name:'Belle unpaid',exact:true})).toBeVisible()
  await page.getByRole('button').filter({has:page.locator('[data-testid="CalendarMonthRoundedIcon"]')}).click();const reset=page.getByRole('dialog',{name:'Filter sale report'});await reset.getByRole('button',{name:'This month',exact:true}).click();await reset.getByRole('button',{name:'Apply',exact:true}).click();await assertMetrics(1500,300,1200)
  await details();await page.screenshot({path:'docs/screenshots/legacy-sales-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844});await page.reload();await assertMetrics(1500,300,1200);await details();await expect(page.getByText('Historical outstanding, all dates: 0 K',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:'docs/screenshots/legacy-sales-mobile.png',fullPage:true})
  expect(await originals()).toEqual(before);expect(errors).toEqual([])
  await old('orders','unpaid').update({total:301}) // fictional negative fixture only
  await page.reload();await expect(page.getByRole('alert')).toContainText(/changed|reconciliation/i,{timeout:30000});await expect(page.getByText('Total Sales',{exact:true})).toHaveCount(0)
 }finally{await page.close();if(vite.exitCode===null&&vite.signalCode===null){const exited=once(vite,'exit');vite.kill();await exited}await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections()})}
})
