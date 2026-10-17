import {test,expect} from '@playwright/test'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'

test('local demo login explains account scope and retained purchase payment retries one receipt, with immutable correction visible on mobile',async({page,request})=>{
  test.setTimeout(120000)
  process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
  const require=createRequire(new URL('../../../BelleLocal POS app/functions/package.json',import.meta.url))
  const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore')
  const app=initializeApp({projectId:'demo-belle-online'},'purchase-settlement-browser-'+randomUUID()),db=getFirestore(app)
  const suffix=randomUUID().slice(0,8),supplierId=randomUUID(),name='Purchase settlement '+suffix,date=new Date().toISOString(),invoice='PS-'+suffix,method='Purchase KPay '+suffix
  // Existing linked supplier/delivery identities are input fixtures. No receipt
  // or linked-supplier writer is inferred from them; the purchase/payments below
  // are created through their actual owner endpoints.
  await db.doc(`onlineShopV2/belle-online/pos_suppliers/${supplierId}`).set({id:supplierId,shopId:'belle-online',name,isActive:true,phone:'0999999',createdAt:date,updatedAt:date})
  const deliveryId=randomUUID()
  await db.doc(`onlineShopV2/belle-online/pos_supplier_delivery_records/${deliveryId}`).set({id:deliveryId,shopId:'belle-online',supplierId,supplierName:name,supplierPhone:'0999999',invoiceNumber:invoice,deliveryName:'Existing delivery',deliveryPhone:'099123',receiverName:'Demo owner',receivedAt:date,dueAt:'2026-10-20',amount:50000,status:'active',createdAt:date,updatedAt:date})
  const login=await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{data:{email:'owner@belle-demo.example',password:'Local-test-only-123!',returnSecureToken:true}});expect(login.ok()).toBeTruthy()
  const headers={Authorization:'Bearer '+(await login.json()).idToken},api='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
  const current=(await (await request.get(api+'settings',{headers})).json()).settings
  expect((await request.patch(api+'settings',{headers,data:{paymentMethods:[...current.paymentMethods,{id:'purchase-kpay-'+suffix,name:method,type:'normal',active:true,sortOrder:5}]}})).ok()).toBeTruthy()
  const createdProduct=await request.post(api+'products',{headers:{...headers,'Idempotency-Key':randomUUID()},data:{name:name+' product',price:60000,cost:50000,units:[{name:'Piece',conversionFactor:1,isBase:true}]}});expect(createdProduct.status()).toBe(201)
  const product=(await createdProduct.json()).product
  const created=await request.post(api+'purchases',{headers:{...headers,'Idempotency-Key':randomUUID()},data:{supplierId,items:[{productId:product.id,quantity:1,unitCost:50000}],expectedAt:'2026-10-20'}});expect(created.status()).toBe(201)
  const purchase=(await created.json()).purchase,errors=[],keys=[];let attempts=0
  page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:5176/#/suppliers')
  await expect(page.getByText('Local demo preview',{exact:true})).toBeVisible({timeout:20000});await expect(page.getByText('Connected to demo-belle-online.',{exact:false})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy()
  await page.getByRole('textbox',{name:'Email',exact:true}).fill('missing-'+suffix+'@belle-demo.example')
  await page.getByRole('textbox',{name:'Password',exact:true}).fill('Local-test-only-123!')
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await expect(page.getByText('This email is not registered in the local demo. Use the demo account shown above.',{exact:true})).toBeVisible()
  await page.screenshot({path:'docs/screenshots/belle-demo-login-mobile.png',fullPage:true})
  await page.getByRole('button',{name:'Use demo account',exact:true}).click()
  await expect(page.getByRole('textbox',{name:'Email',exact:true})).toHaveValue('owner@belle-demo.example')
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await page.setViewportSize({width:1365,height:950})
  const search=page.getByPlaceholder('Search suppliers by name or invoice number',{exact:true});await expect(search).toBeVisible({timeout:20000});await search.fill(purchase.purchaseNumber)
  await expect(page.getByText('1 Suppliers',{exact:true})).toBeVisible({timeout:20000})
  await page.getByRole('button',{name:'Pay '+name,exact:true}).click();let dialog=page.getByRole('dialog')
  await dialog.getByPlaceholder('Enter payment amount',{exact:true}).fill('10000');await dialog.getByRole('textbox',{name:/^Receiver Name/}).fill('Purchase receiver');await dialog.getByRole('textbox',{name:/^Receiver Phone/}).fill('09923456');await dialog.getByLabel(/^Due Date/).fill('2026-10-20')
  const bounds=await dialog.getByLabel('Receiver signature pad',{exact:true}).boundingBox();expect(bounds).toBeTruthy()
  await page.mouse.move(bounds.x+25,bounds.y+45);await page.mouse.down();await page.mouse.move(bounds.x+120,bounds.y+70,{steps:8});await page.mouse.move(bounds.x+180,bounds.y+35,{steps:8});await page.mouse.up()
  await page.screenshot({path:'docs/screenshots/retails-purchase-cash-payment-desktop.png',fullPage:true})
  await page.route('**/purchases/'+purchase.id+'/payments',async route=>{
    if(route.request().method()!=='POST'){await route.continue();return}
    keys.push(route.request().headers()['idempotency-key']);attempts++
    if(attempts===1){const response=await route.fetch();expect(response.status()).toBe(201);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Purchase payment response interrupted. Retry.'})});return}
    await route.continue()
  })
  await dialog.getByRole('button',{name:'Add Payment',exact:true}).click();await expect(dialog.getByText('Purchase payment response interrupted. Retry.',{exact:true})).toBeVisible()
  await dialog.getByRole('button',{name:'Add Payment',exact:true}).click();await expect(dialog).toHaveCount(0,{timeout:20000});expect(keys).toHaveLength(2);expect(keys[0]).toBeTruthy();expect(keys[1]).toBe(keys[0])
  let saved=(await (await request.get(api+'purchases?search='+purchase.purchaseNumber,{headers})).json()).purchases[0];expect(saved.paidAmount).toBe(10000);expect(saved.payments).toHaveLength(1)
  const original=saved.payments[0];expect(original.signatureDataUrl).toMatch(/^data:image\/png;base64,/);expect(original.payerName).toBe('Purchase receiver')
  // The reference retained purchase screen does not expose a reversal control.
  // Exercise the real endpoint, then verify its correction in the actual UI.
  const reversed=await request.post(api+'purchases/'+purchase.id+'/payments/'+original.id+'/reverse',{headers,data:{reason:'Immutable purchase correction'}});expect(reversed.status()).toBe(201)
  expect((await db.doc(`onlineShopV2/belle-online/pos_purchase_payments/${original.id}`).get()).data()).toEqual(original)
  await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:5176/#/suppliers/'+supplierId)
  await expect(page.getByText('Payment Summary',{exact:true})).toHaveCount(1,{timeout:20000});await expect(page.getByText('Cancelled Payment / Refund Record',{exact:true})).toBeVisible();await expect(page.getByText('Immutable purchase correction',{exact:true})).toBeVisible();await expect(page.getByRole('img',{name:'Receiver signature',exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();await page.screenshot({path:'docs/screenshots/retails-purchase-correction-mobile.png',fullPage:true})
  await page.getByRole('button',{name:'Add Payment',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('combobox',{name:/^Payment Method/}).click();await page.getByRole('option',{name:method,exact:true}).click()
  await dialog.getByPlaceholder('Enter payment amount',{exact:true}).fill('50000');await dialog.getByRole('textbox',{name:/^Receiver Mobile Payment User Name/}).fill('Purchase mobile receiver');await dialog.getByRole('textbox',{name:/^Receiver Mobile Payment Number/}).fill('099456789');await dialog.getByRole('textbox',{name:/^Transaction ID/}).fill('PS-TRX-'+suffix)
  await page.screenshot({path:'docs/screenshots/retails-purchase-mobile-payment.png',fullPage:true});await dialog.getByRole('button',{name:'Add Payment',exact:true}).click();await expect(dialog).toHaveCount(0,{timeout:20000})
  saved=(await (await request.get(api+'purchases?search='+purchase.purchaseNumber,{headers})).json()).purchases[0];expect(saved.paidAmount).toBe(50000);expect(saved.paymentStatus).toBe('paid');expect(saved.payments).toHaveLength(2);expect(saved.payments.find(row=>row.id!==original.id)).toMatchObject({method,amount:50000,mobileAccountName:'Purchase mobile receiver',reference:'PS-TRX-'+suffix})
  await expect(page.getByText('Payment Summary',{exact:true})).toHaveCount(2,{timeout:20000});await expect(page.getByText('Cancelled Payment / Refund Record',{exact:true})).toHaveCount(1);await expect(page.getByRole('button',{name:'Add Payment',exact:true})).toHaveCount(0)
  expect(saved.receipts).toHaveLength(0);expect((await (await request.get(api+'products/'+product.id,{headers})).json()).product.currentStock).toBe(0);expect(errors).toEqual([])
  await page.evaluate(()=>window.scrollTo(0,0))
  await page.screenshot({path:'docs/screenshots/retails-purchase-history-mobile.png',fullPage:true})
})

test('retained Supplier list displays a real purchase draft and sent order on desktop/mobile while stock stays unchanged',async({page,request})=>{
  test.setTimeout(90000)
  // Only the existing linked supplier is an input fixture. The reference's Add
  // Supplier form creates an unlinked delivery invoice rather than this entity.
  process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
  const require=createRequire(new URL('../../../BelleLocal POS app/functions/package.json',import.meta.url))
  const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore')
  const app=initializeApp({projectId:'demo-belle-online'},'purchase-browser-'+randomUUID()),db=getFirestore(app)
  const supplierId=randomUUID(),name='Purchase UI '+randomUUID().slice(0,8),date=new Date().toISOString()
  await db.doc(`onlineShopV2/belle-online/pos_suppliers/${supplierId}`).set({id:supplierId,shopId:'belle-online',name,isActive:true,phone:'0999999',createdAt:date,updatedAt:date})
  const login=await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{data:{email:'owner@belle-demo.example',password:'Local-test-only-123!',returnSecureToken:true}});expect(login.ok()).toBeTruthy()
  const headers={Authorization:'Bearer '+(await login.json()).idToken},api='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
  const productResponse=await request.post(api+'products',{headers:{...headers,'Idempotency-Key':randomUUID()},data:{name:name+' product',price:200,cost:100,units:[{name:'Piece',conversionFactor:1,isBase:true}]}});expect(productResponse.status()).toBe(201)
  const product=(await productResponse.json()).product,key=randomUUID(),input={supplierId,items:[{productId:product.id,quantity:3,unitCost:101}],deliveryCost:50,expectedAt:'2026-10-20'}
  const created=await request.post(api+'purchases',{headers:{...headers,'Idempotency-Key':key},data:input});expect(created.status()).toBe(201);const purchase=(await created.json()).purchase
  expect(purchase.total).toBe(353);expect(purchase.status).toBe('draft')
  const replay=await request.post(api+'purchases',{headers:{...headers,'Idempotency-Key':key},data:input});expect(await replay.json()).toEqual({purchase})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto('http://127.0.0.1:5176/#/suppliers')
  await page.getByRole('textbox',{name:'Email',exact:true}).fill('owner@belle-demo.example');await page.getByRole('textbox',{name:'Password',exact:true}).fill('Local-test-only-123!');await page.getByRole('button',{name:/Sign in|Login/i}).click()
  await expect(page.getByPlaceholder('Search suppliers by name or invoice number')).toBeVisible({timeout:20000})
  await page.getByPlaceholder('Search suppliers by name or invoice number').fill(purchase.purchaseNumber)
  await expect(page.getByText('1 Suppliers',{exact:true})).toBeVisible({timeout:20000})
  await expect(page.getByText(name,{exact:true})).toBeVisible({timeout:20000});await expect(page.getByText(purchase.purchaseNumber,{exact:true})).toBeVisible()
  await page.screenshot({path:'docs/screenshots/retails-purchase-draft-desktop.png',fullPage:true})
  const sent=await request.post(api+'purchases/'+purchase.id+'/send',{headers,data:{}});expect(sent.status()).toBe(200);expect((await sent.json()).purchase.status).toBe('ordered')
  await page.setViewportSize({width:390,height:844});await page.reload()
  const search=page.getByRole('textbox',{name:'Search suppliers by name or invoice number',exact:true});await expect(search).toBeVisible({timeout:20000});await search.fill(purchase.purchaseNumber)
  await expect(page.getByText('1 Suppliers',{exact:true})).toBeVisible({timeout:20000})
  await expect(page.getByText(name,{exact:true})).toBeVisible({timeout:20000});await expect(page.getByText(purchase.purchaseNumber,{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy()
  await page.screenshot({path:'docs/screenshots/retails-purchase-ordered-mobile.png',fullPage:true})
  const stored=await request.get(api+'products/'+product.id,{headers});expect((await stored.json()).product.currentStock).toBe(0)
  const listed=await request.get(api+'purchases?search='+purchase.purchaseNumber,{headers});const records=(await listed.json()).purchases;expect(records).toHaveLength(1);expect(records[0].paidAmount).toBe(0);expect(records[0].receipts).toHaveLength(0)
  expect(errors).toEqual([])
})
