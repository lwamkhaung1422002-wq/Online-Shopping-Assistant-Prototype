import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {signatureFixture} from '../handover-signature-fixture.mjs'
const preview='http://127.0.0.1:5176/',api='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
test('retained mobile COD form receives one real receipt after actual preparation and handover, recovering a lost response',async({page,request})=>{
  test.setTimeout(90000)
  const signIn=await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{data:{email:'owner@belle-demo.example',password:'Local-test-only-123!',returnSecureToken:true}})
  expect(signIn.ok()).toBeTruthy();const auth={Authorization:'Bearer '+(await signIn.json()).idToken},suffix=randomUUID().slice(0,8)
  const productResponse=await request.post(api+'products',{headers:auth,data:{name:'COD dress '+suffix,price:5000,cost:2000,units:[{name:'Piece',isBase:true,conversionFactor:1}],openingStock:{quantity:3,unitCost:2000}}});expect(productResponse.status()).toBe(201)
  const product=(await productResponse.json()).product,customerResponse=await request.post(api+'customers',{headers:auth,data:{name:'COD buyer '+suffix,phone:'099999',address:'COD test street'}});expect(customerResponse.status()).toBe(201)
  const customer=(await customerResponse.json()).customer,checkout=await request.post(api+'orders/checkout',{headers:{...auth,'Idempotency-Key':randomUUID()},data:{saleType:'ONLINE',paymentMode:'PARTIAL_COD',customerId:customer.id,initialPayment:{method:'Cash',amount:1000},items:[{productId:product.id,quantity:1}]}});expect(checkout.status()).toBe(201)
  const order=(await checkout.json()).order
  expect((await request.post(api+'order-operations/'+order.id+'/start',{headers:auth,data:{}})).status()).toBe(200)
  for(const item of order.items)expect((await request.put(api+'order-operations/'+order.id+'/items/'+item.id,{headers:auth,data:{prepared:true}})).status()).toBe(200)
  expect((await request.post(api+'order-operations/'+order.id+'/ready',{headers:auth,data:{}})).status()).toBe(200)
  const handover=await request.post(api+'delivery-handovers',{headers:{...auth,'Idempotency-Key':randomUUID()},data:{orderIds:[order.id],receiverName:'COD courier',receiverPhone:'099999',signatureDataUrl:signatureFixture(),verifiedItems:order.items.map((item)=>({orderItemId:item.id,quantity:String(Number(item.enteredQuantity??item.quantity)),unit:item.pricingSnapshot.unitSymbol??''}))}})
  expect(handover.status()).toBe(201)
  expect((await (await request.get(api+'products/'+product.id,{headers:auth})).json()).product.currentStock).toBe(2)
  const statement=String(Date.now()).slice(-6),transaction=String(Date.now()+1).slice(-6),errors=[],keys=[];let attempts=0
  page.on('pageerror',(error)=>errors.push(error.message));await page.setViewportSize({width:390,height:844});await page.goto(preview+'#/payment')
  await page.getByRole('textbox',{name:'Email',exact:true}).fill('owner@belle-demo.example');await page.getByRole('textbox',{name:'Password',exact:true}).fill('Local-test-only-123!');await page.getByRole('button',{name:/Sign in|Login/i}).click()
  await page.getByRole('button',{name:'Add Payment',exact:true}).click();await page.getByRole('tab',{name:'COD',exact:true}).click()
  await page.getByLabel('Search COD invoices',{exact:true}).fill(order.orderNumber)
  await page.getByRole('checkbox',{name:'Select invoice '+order.orderNumber,exact:true}).check()
  await page.getByRole('textbox',{name:/^COD Statement Number \(last 6 digits\)/}).fill(statement)
  await page.getByRole('textbox',{name:/^Transaction ID \(last 6 digits\)/}).fill(transaction)
  await page.route('**/payments/cod-settlements/receive',async(route)=>{
    keys.push(route.request().headers()['idempotency-key']);attempts++
    if(attempts===1){const response=await route.fetch();expect(response.status()).toBe(201);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'COD response interrupted. Retry.'})});return}
    await route.continue()
  })
  await page.getByRole('button',{name:'Record COD Payment',exact:true}).click();await expect(page.getByRole('alert')).toContainText('COD response interrupted.')
  await page.getByRole('button',{name:'Record COD Payment',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0,{timeout:20000})
  expect(keys).toHaveLength(2);expect(keys[1]).toBe(keys[0])
  const payments=(await (await request.get(api+'payments',{headers:auth})).json()).payments.filter((payment)=>payment.orderId===order.id)
  expect(payments).toHaveLength(2);const receipt=payments.find((payment)=>payment.scope==='cod-receipt');expect(receipt.amount).toBe(4000);expect(receipt.billNumber).toBe(statement)
  const pending=await request.get(api+'payments/cod-pending?search='+order.orderNumber,{headers:auth});expect((await pending.json()).invoices).toHaveLength(0)
  await page.goto(preview+'#/sale/'+order.id);await page.reload()
  await expect(page.getByText('COD Number: '+statement,{exact:true})).toBeVisible({timeout:20000})
  await expect(page.getByText('Transaction ID: '+transaction,{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy()
  await page.screenshot({path:'docs/screenshots/retails-cod-receipt-mobile.png',fullPage:true})
  expect(errors).toEqual([])
})
