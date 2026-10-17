import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
const preview='http://127.0.0.1:5176/',api='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
test('retained Payment page settles remaining credit once after a lost response and reloads both immutable receipts on mobile',async({page,request})=>{
  test.setTimeout(90000)
  const signIn=await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{data:{email:'owner@belle-demo.example',password:'Local-test-only-123!',returnSecureToken:true}})
  expect(signIn.ok()).toBeTruthy();const auth={Authorization:'Bearer '+(await signIn.json()).idToken},suffix=randomUUID().slice(0,8),customerName='Payment buyer '+suffix
  const productResponse=await request.post(api+'products',{headers:auth,data:{name:'Payment dress '+suffix,price:5000,cost:2000,units:[{name:'Piece',isBase:true,conversionFactor:1}],openingStock:{quantity:2,unitCost:2000}}});expect(productResponse.status()).toBe(201)
  const product=(await productResponse.json()).product,customerResponse=await request.post(api+'customers',{headers:auth,data:{name:customerName,phone:'099999'}});expect(customerResponse.status()).toBe(201)
  const customer=(await customerResponse.json()).customer,checkout=await request.post(api+'orders/checkout',{headers:{...auth,'Idempotency-Key':randomUUID()},data:{saleType:'IN_STORE',paymentMode:'PARTIAL',customerId:customer.id,initialPayment:{method:'Cash',amount:1000},items:[{productId:product.id,quantity:1}]}});expect(checkout.status()).toBe(201)
  const order=(await checkout.json()).order,original=order.payments[0],errors=[]
  page.on('pageerror',(error)=>errors.push(error.message));await page.setViewportSize({width:1365,height:950});await page.goto(preview+'#/payment')
  await page.getByRole('textbox',{name:'Email',exact:true}).fill('owner@belle-demo.example');await page.getByRole('textbox',{name:'Password',exact:true}).fill('Local-test-only-123!');await page.getByRole('button',{name:/Sign in|Login/i}).click()
  await page.getByRole('textbox',{name:'Search',exact:true}).fill(order.orderNumber)
  await expect(page.getByRole('button',{name:'More actions for '+customerName,exact:true})).toBeVisible({timeout:20000})
  await expect(page.getByText('Partial',{exact:true}).first()).toBeVisible()
  await page.screenshot({path:'docs/screenshots/retails-payment-worklist-desktop.png',fullPage:true})
  const keys=[];let attempts=0
  await page.route('**/orders/'+order.id+'/payments',async(route)=>{
    if(route.request().method()!=='POST'){await route.continue();return}
    keys.push(route.request().headers()['idempotency-key']);attempts++
    if(attempts===1){const response=await route.fetch();expect(response.status()).toBe(201);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Collection response interrupted. Retry the same payment.'})});return}
    await route.continue()
  })
  await page.getByRole('button',{name:'More actions for '+customerName,exact:true}).click();await page.getByRole('menuitem',{name:'Pay',exact:true}).click()
  const dialog=page.getByRole('dialog')
  await expect(dialog.getByText('The full remaining balance will be settled automatically.',{exact:true})).toBeVisible()
  await dialog.getByLabel('Remark',{exact:true}).fill('Payment page collection')
  await dialog.getByRole('button',{name:'Record Payment',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText('Collection response interrupted.')
  await dialog.getByRole('button',{name:'Record Payment',exact:true}).click();await expect(dialog).toHaveCount(0,{timeout:20000})
  expect(keys).toHaveLength(2);expect(keys[0]).toBeTruthy();expect(keys[1]).toBe(keys[0])
  await expect(page.getByText('Paid',{exact:true}).first()).toBeVisible()
  const paymentsResponse=await request.get(api+'payments',{headers:auth}),payments=(await paymentsResponse.json()).payments.filter((value)=>value.orderId===order.id)
  expect(payments).toHaveLength(2);expect(payments.find((value)=>value.id===original.id)?.amount).toBe(1000)
  expect(payments.find((value)=>value.id!==original.id)?.amount).toBe(4000)
  const ledger=await request.get(api+'products/'+product.id,{headers:auth});expect((await ledger.json()).product.currentStock).toBe(1)
  await page.setViewportSize({width:390,height:844});await page.reload()
  await page.getByRole('textbox',{name:'Search',exact:true}).fill(order.orderNumber)
  await expect(page.getByText(customerName,{exact:true})).toBeVisible({timeout:20000});await expect(page.getByText('Paid',{exact:true}).first()).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy()
  await page.screenshot({path:'docs/screenshots/retails-payment-worklist-mobile.png',fullPage:true})
  await page.goto(preview+'#/payment/history')
  const filteredHistory=page.waitForResponse((response)=>{
    const url=new URL(response.url())
    return url.pathname.endsWith('/payment-history')&&url.searchParams.get('view')==='history'&&url.searchParams.get('search')===order.orderNumber
  })
  await page.getByPlaceholder('Search supplier, invoice or transaction ID',{exact:true}).fill(order.orderNumber)
  expect((await filteredHistory).ok()).toBeTruthy()
  await expect(page.getByText('Invoice: '+order.orderNumber,{exact:false})).toHaveCount(2,{timeout:20000})
  await expect(page.getByText('Loading records…',{exact:true})).toHaveCount(0)
  await expect(page.getByText('No payment records found.',{exact:true})).toHaveCount(0)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy()
  await page.screenshot({path:'docs/screenshots/retails-payment-history-mobile.png',fullPage:true})
  expect(errors).toEqual([])
})
