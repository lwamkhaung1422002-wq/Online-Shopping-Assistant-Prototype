import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
const preview='http://127.0.0.1:5176/',api='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
async function headers(request){const response=await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{data:{email:'owner@belle-demo.example',password:'Local-test-only-123!',returnSecureToken:true}});expect(response.ok()).toBeTruthy();return {Authorization:'Bearer '+(await response.json()).idToken}}
async function seed(request,auth){const name='Browser checkout '+randomUUID().slice(0,8),response=await request.post(api+'products',{headers:{...auth,'Idempotency-Key':randomUUID()},data:{name,price:5000,cost:2000,units:[{name:'Piece',isBase:true,conversionFactor:1}],openingStock:{quantity:3,unitCost:2000}}});expect(response.status()).toBe(201);return (await response.json()).product}
async function signIn(page){await page.goto(preview+'#/sale/create');await page.getByRole('textbox',{name:'Email',exact:true}).fill('owner@belle-demo.example');await page.getByRole('textbox',{name:'Password',exact:true}).fill('Local-test-only-123!');await page.getByRole('button',{name:/Sign in|Login/i}).click()}

test('retained desktop Create Order refreshes a changed price then commits one sale and payment through Firebase',async({page,request})=>{
  test.setTimeout(90000)
  const auth=await headers(request),product=await seed(request,auth),errors=[]
  page.on('pageerror',(error)=>errors.push(error.message));await page.setViewportSize({width:1365,height:950});await signIn(page)
  await page.getByPlaceholder('Search by product code, name or barcode...').fill(product.name)
  await expect(page.getByLabel('Quantity for '+product.name)).toBeVisible({timeout:20000})
  await page.getByLabel('Quantity for '+product.name).fill('1');await page.getByLabel('Quantity for '+product.name).press('Enter')
  await expect(page.getByLabel('Quantity for '+product.name)).toHaveValue('1')
  await page.getByLabel('Amount received',{exact:true}).fill('6000')
  const edit=await request.patch(api+'products/'+product.id,{headers:auth,data:{price:5500,expectedVersion:product.version}});expect(edit.ok()).toBeTruthy()
  const conflictResponse=page.waitForResponse((response)=>response.url().endsWith('/orders/checkout')&&response.request().method()==='POST')
  await page.getByRole('button',{name:'Create Order',exact:true}).click()
  const conflict=await conflictResponse;expect(conflict.status()).toBe(409);expect((await conflict.json()).code).toBe('PRICE_CHANGED')
  await expect(page.getByText('Prices or promotions have changed. Review the updated total before saving.',{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>sessionStorage.getItem('checkout:belle-online'))).toBeNull()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy()
  await page.screenshot({path:'docs/screenshots/retails-checkout-desktop.png',fullPage:true})
  const createdResponse=page.waitForResponse((response)=>response.url().endsWith('/orders/checkout')&&response.request().method()==='POST')
  await page.getByRole('button',{name:'Create Order',exact:true}).click()
  const response=await createdResponse;expect(response.status()).toBe(201);const order=(await response.json()).order
  await expect(page.getByText('Order '+order.orderNumber+' created successfully.',{exact:true})).toBeVisible()
  expect(order.total).toBe(5500);expect(order.payments[0].amount).toBe(5500);expect(order.fulfillmentStatus).toBe('completed')
  const fresh=await request.get(api+'products/'+product.id,{headers:auth});expect((await fresh.json()).product.availableStock).toBe(2)
  expect(await page.evaluate(()=>sessionStorage.getItem('checkout:belle-online'))).toBeNull();expect(errors).toEqual([])
})

test('retained mobile checkout selects a saved customer and saves an online COD reservation with snapshots',async({page,request})=>{
  test.setTimeout(90000)
  const auth=await headers(request),product=await seed(request,auth),name='COD customer '+randomUUID().slice(0,8),errors=[]
  const customerResponse=await request.post(api+'customers',{headers:auth,data:{name,phone:'099999999',address:'Emulator delivery street',city:'Yangon'}});expect(customerResponse.status()).toBe(201)
  const customer=(await customerResponse.json()).customer
  page.on('pageerror',(error)=>errors.push(error.message));await page.setViewportSize({width:390,height:844});await signIn(page)
  await page.getByRole('button',{name:'Add Product',exact:true}).click()
  await page.getByPlaceholder('Search products...',{exact:true}).fill(product.name)
  await page.getByRole('button',{name:'Add '+product.name,exact:true}).click()
  await expect(page.getByLabel('Quantity for '+product.name)).toHaveValue('1')
  await page.getByRole('button',{name:'Online Sale',exact:true}).click()
  await page.getByRole('combobox',{name:'Customer',exact:true}).fill(name)
  await page.getByRole('option').filter({hasText:name}).click()
  await expect(page.getByRole('button',{name:'COD',exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy()
  await page.screenshot({path:'docs/screenshots/retails-checkout-mobile.png',fullPage:true})
  const createdResponse=page.waitForResponse((response)=>response.url().endsWith('/orders/checkout')&&response.request().method()==='POST')
  await page.getByRole('button',{name:'Create Order',exact:true}).click()
  const response=await createdResponse;expect(response.status()).toBe(201);const order=(await response.json()).order
  await expect(page.getByText('Order '+order.orderNumber+' created successfully.',{exact:true})).toBeVisible()
  expect(order.customerId).toBe(customer.id);expect(order.paymentMode).toBe('COD');expect(order.codCollectAmount).toBe(5000);expect(order.payments).toEqual([])
  expect(order.fulfillmentStatus).toBe('reserved');expect(order.recipientSnapshot.address).toBe('Emulator delivery street')
  const fresh=await request.get(api+'products/'+product.id,{headers:auth});expect((await fresh.json()).product.currentStock).toBe(3)
  const detail=await request.get(api+'orders/'+order.id,{headers:auth});expect((await detail.json()).order.id).toBe(order.id)
  expect(errors).toEqual([])
})
