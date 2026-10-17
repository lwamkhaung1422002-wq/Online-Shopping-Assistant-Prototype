import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
const preview='http://127.0.0.1:5176/',api='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'

test('retained supplier payment form signs cash, retries one receipt, reverses without erasing it and records a mobile payment visible in history',async({page,request})=>{
  test.setTimeout(120000)
  const login=await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{data:{email:'owner@belle-demo.example',password:'Local-test-only-123!',returnSecureToken:true}});expect(login.ok()).toBeTruthy()
  const auth={Authorization:'Bearer '+(await login.json()).idToken},suffix=randomUUID().slice(0,8),name='Supplier payment '+suffix,invoice='SP-'+suffix,method='KPay '+suffix
  const current=(await (await request.get(api+'settings',{headers:auth})).json()).settings
  expect((await request.patch(api+'settings',{headers:auth,data:{paymentMethods:[...current.paymentMethods,{id:'kpay-'+suffix,name:method,type:'normal',active:true,sortOrder:5}]}})).ok()).toBeTruthy()
  const created=await request.post(api+'suppliers',{headers:auth,data:{name,phone:'0999999',deliveryRecord:{invoiceNumber:invoice,deliveryName:'Supplier truck',deliveryPhone:'0912345',receivedAt:'2026-10-11',dueAt:'2026-10-20',amount:50000}}});expect(created.status()).toBe(201)
  const record=(await created.json()).record,errors=[],keys=[];let attempts=0
  page.on('pageerror',(error)=>errors.push(error.message));await page.setViewportSize({width:1365,height:950});await page.goto(preview+'#/suppliers')
  await page.getByRole('textbox',{name:'Email',exact:true}).fill('owner@belle-demo.example');await page.getByRole('textbox',{name:'Password',exact:true}).fill('Local-test-only-123!');await page.getByRole('button',{name:/Sign in|Login/i}).click()
  await page.getByPlaceholder('Search suppliers by name or invoice number',{exact:true}).fill(invoice)
  await page.getByRole('button',{name:'Pay '+name,exact:true}).click()
  let dialog=page.getByRole('dialog')
  await dialog.getByPlaceholder('Enter payment amount',{exact:true}).fill('10000')
  await dialog.getByRole('textbox',{name:/^Receiver Name/}).fill('Signed supplier receiver')
  await dialog.getByRole('textbox',{name:/^Receiver Phone/}).fill('09923456')
  await dialog.getByLabel(/^Due Date/).fill('2026-10-20')
  const pad=dialog.getByLabel('Receiver signature pad',{exact:true}),bounds=await pad.boundingBox();expect(bounds).toBeTruthy()
  await page.mouse.move(bounds.x+25,bounds.y+45);await page.mouse.down();await page.mouse.move(bounds.x+100,bounds.y+70,{steps:8});await page.mouse.move(bounds.x+180,bounds.y+35,{steps:8});await page.mouse.up()
  await page.screenshot({path:'docs/screenshots/retails-supplier-cash-payment-desktop.png',fullPage:true})
  await page.route('**/supplier-delivery-records/'+record.id+'/payments',async(route)=>{
    if(route.request().method()!=='POST'){await route.continue();return}
    keys.push(route.request().headers()['idempotency-key']);attempts++
    if(attempts===1){const response=await route.fetch();expect(response.status()).toBe(201);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Supplier receipt response interrupted. Retry.'})});return}
    await route.continue()
  })
  await dialog.getByRole('button',{name:'Add Payment',exact:true}).click()
  await expect(dialog.getByText('Supplier receipt response interrupted. Retry.',{exact:true})).toBeVisible()
  await dialog.getByRole('button',{name:'Add Payment',exact:true}).click();await expect(dialog).toHaveCount(0,{timeout:20000})
  expect(keys).toHaveLength(2);expect(keys[1]).toBe(keys[0]);expect(keys[0]).toBeTruthy()
  let saved=(await (await request.get(api+'supplier-delivery-records/'+record.id,{headers:auth})).json()).record
  expect(saved.remaining).toBe(40000);expect(saved.payments).toHaveLength(1)
  const original=saved.payments[0];expect(original.signatureDataUrl).toMatch(/^data:image\/png;base64,/);expect(original.payerName).toBe('Signed supplier receiver')
  await page.setViewportSize({width:390,height:844});await page.reload()
  await page.getByPlaceholder('Search...',{exact:true}).fill(invoice)
  await page.getByRole('button',{name:'More actions for '+name,exact:true}).click();await page.getByRole('menuitem',{name:'Cancel Payment',exact:true}).click()
  dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:/^Cancel Payment Reason/}).fill('Preserve receipt with separate reversal')
  await page.screenshot({path:'docs/screenshots/retails-supplier-reversal-mobile.png',fullPage:true})
  await dialog.getByRole('button',{name:'Cancel Payment',exact:true}).click();await expect(dialog).toHaveCount(0,{timeout:20000})
  saved=(await (await request.get(api+'supplier-delivery-records/'+record.id,{headers:auth})).json()).record
  expect(saved.remaining).toBe(50000);expect(saved.payments).toHaveLength(1)
  const corrected=saved.payments[0];expect({...corrected,reversal:null}).toEqual(original);expect(corrected.reversal.reason).toBe('Preserve receipt with separate reversal')
  await page.getByRole('button',{name:'More actions for '+name,exact:true}).click();await page.getByRole('menuitem',{name:'Pay',exact:true}).click()
  dialog=page.getByRole('dialog');await dialog.getByRole('combobox',{name:/^Payment Method/}).click();await page.getByRole('option',{name:method,exact:true}).click()
  await dialog.getByPlaceholder('Enter payment amount',{exact:true}).fill('50000')
  await dialog.getByRole('textbox',{name:/^Receiver Mobile Payment User Name/}).fill('Mobile supplier receiver')
  await dialog.getByRole('textbox',{name:/^Receiver Mobile Payment Number/}).fill('099456789')
  await dialog.getByRole('textbox',{name:/^Transaction ID/}).fill('SUP-TRX-'+suffix)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy()
  await page.screenshot({path:'docs/screenshots/retails-supplier-mobile-payment.png',fullPage:true})
  await dialog.getByRole('button',{name:'Add Payment',exact:true}).click();await expect(dialog).toHaveCount(0,{timeout:20000})
  saved=(await (await request.get(api+'supplier-delivery-records/'+record.id,{headers:auth})).json()).record
  expect(saved.invoiceStatus).toBe('Paid');expect(saved.activePaid).toBe(50000);expect(saved.payments).toHaveLength(2)
  expect(saved.payments.find((row)=>row.id!==original.id)).toMatchObject({amount:50000,method,mobileAccountName:'Mobile supplier receiver',reference:'SUP-TRX-'+suffix,signatureDataUrl:null})
  await page.reload();await page.getByPlaceholder('Search...',{exact:true}).fill(invoice);await expect(page.getByText(name,{exact:true})).toBeVisible({timeout:20000});await expect(page.getByText('Paid',{exact:true}).first()).toBeVisible()
  await page.goto(preview+'#/payment/history')
  const filtered=page.waitForResponse((response)=>{const url=new URL(response.url());return url.pathname.endsWith('/payment-history')&&url.searchParams.get('view')==='history'&&url.searchParams.get('search')===invoice})
  await page.getByPlaceholder('Search supplier, invoice or transaction ID',{exact:true}).fill(invoice);expect((await filtered).ok()).toBeTruthy()
  await expect(page.getByText('Invoice: '+invoice,{exact:false})).toHaveCount(3,{timeout:20000})
  await expect(page.getByText('Loading records…',{exact:true})).toHaveCount(0);expect(errors).toEqual([])
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy()
  await page.screenshot({path:'docs/screenshots/retails-supplier-payment-history-mobile.png',fullPage:true})
})
