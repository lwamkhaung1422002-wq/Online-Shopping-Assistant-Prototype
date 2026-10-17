import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
const preview='http://127.0.0.1:5176/',api='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
async function headers(request){const response=await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{data:{email:'owner@belle-demo.example',password:'Local-test-only-123!',returnSecureToken:true}});expect(response.ok()).toBeTruthy();return {Authorization:'Bearer '+(await response.json()).idToken}}
test('retained Sale list and invoice details reload real collections and preserve receipt payment evidence on desktop/mobile',async({page,request})=>{
  test.setTimeout(90000)
  const auth=await headers(request),name='Receipt dress '+randomUUID().slice(0,8),errors=[]
  const created=await request.post(api+'products',{headers:auth,data:{name,price:5000,cost:2000,units:[{name:'Piece',isBase:true,conversionFactor:1}],openingStock:{quantity:3,unitCost:2000}}});expect(created.status()).toBe(201)
  const product=(await created.json()).product,customerResponse=await request.post(api+'customers',{headers:auth,data:{name:'Invoice customer '+randomUUID().slice(0,8),phone:'09999999'}}),customer=(await customerResponse.json()).customer
  const response=await request.post(api+'orders/checkout',{headers:{...auth,'Idempotency-Key':randomUUID()},data:{saleType:'IN_STORE',paymentMode:'PARTIAL',customerId:customer.id,initialPayment:{method:'Cash',amount:1000},items:[{productId:product.id,quantity:1}]}});expect(response.status()).toBe(201)
  const order=(await response.json()).order
  page.on('pageerror',(error)=>errors.push(error.message));await page.setViewportSize({width:1365,height:950});await page.goto(preview+'#/sale')
  await page.getByRole('textbox',{name:'Email',exact:true}).fill('owner@belle-demo.example');await page.getByRole('textbox',{name:'Password',exact:true}).fill('Local-test-only-123!');await page.getByRole('button',{name:/Sign in|Login/i}).click()
  await page.getByPlaceholder('Search order, customer, product or payment').fill(order.orderNumber)
  await expect(page.getByRole('button',{name:'View '+order.orderNumber+' details',exact:true})).toBeVisible({timeout:20000})
  await page.getByRole('button',{name:'View '+order.orderNumber+' details',exact:true}).click()
  await expect(page.getByText('Payment Summary',{exact:true})).toBeVisible({timeout:20000})
  await expect(page.getByText(name,{exact:true})).toBeVisible()
  const receiptResponse=await request.get(api+'orders/'+order.id,{headers:auth}),receipt=(await receiptResponse.json()).receipt
  expect(receipt.totals.paid).toBe(1000);expect(receipt.totals.outstanding).toBe(4000);expect(receipt.cashier.name).toBe('Demo Belle Owner')
  await page.screenshot({path:'docs/screenshots/retails-sale-details-desktop.png',fullPage:true})
  const payment=await request.post(api+'orders/'+order.id+'/payments',{headers:{...auth,'Idempotency-Key':randomUUID()},data:{method:'Cash',scope:'credit-settlement'}});expect(payment.status()).toBe(201)
  await page.setViewportSize({width:390,height:844});await page.goto(preview+'#/sale/'+order.id);await page.reload()
  await expect(page.getByText('Payment Summary',{exact:true})).toBeVisible({timeout:20000})
  await expect(page.getByText('Paid',{exact:true}).first()).toBeVisible()
  await expect(page.getByText(name,{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy()
  await page.screenshot({path:'docs/screenshots/retails-sale-details-mobile.png',fullPage:true})
  const updated=(await (await request.get(api+'orders/'+order.id,{headers:auth})).json()).receipt
  expect(updated.totals.paid).toBe(5000);expect(updated.payments.length).toBe(2)
  expect(updated.payments.find((entry)=>entry.id===receipt.payments[0].id)).toEqual(receipt.payments[0])
  expect(updated.payments.find((entry)=>entry.id!==receipt.payments[0].id)?.amount).toBe(4000)
  expect(errors).toEqual([])
})
