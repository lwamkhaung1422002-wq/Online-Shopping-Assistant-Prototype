import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
const preview='http://127.0.0.1:5176/',api='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'

test('retained mobile Operation prepares every item, collects an actual canvas signature and creates one delivery after a lost response',async({page,request})=>{
  test.setTimeout(120000)
  const signIn=await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{data:{email:'owner@belle-demo.example',password:'Local-test-only-123!',returnSecureToken:true}});expect(signIn.ok()).toBeTruthy()
  const auth={Authorization:'Bearer '+(await signIn.json()).idToken},suffix=randomUUID().slice(0,8),name='Delivery dress '+suffix
  const productResponse=await request.post(api+'products',{headers:auth,data:{name,price:5000,cost:2000,units:[{name:'Piece',isBase:true,conversionFactor:1}],openingStock:{quantity:3,unitCost:2000}}});expect(productResponse.status()).toBe(201);const product=(await productResponse.json()).product
  const customerResponse=await request.post(api+'customers',{headers:auth,data:{name:'Delivery buyer '+suffix,phone:'099999',address:'Original saved address'}});expect(customerResponse.status()).toBe(201)
  const customer=(await customerResponse.json()).customer,checkout=await request.post(api+'orders/checkout',{headers:{...auth,'Idempotency-Key':randomUUID()},data:{saleType:'ONLINE',paymentMode:'COD',customerId:customer.id,items:[{productId:product.id,quantity:1}]}});expect(checkout.status()).toBe(201);const order=(await checkout.json()).order
  const keys=[],errors=[];let attempts=0
  page.on('pageerror',(error)=>errors.push(error.message));await page.setViewportSize({width:390,height:844});await page.goto(preview+'#/stock/operation')
  await page.getByRole('textbox',{name:'Email',exact:true}).fill('owner@belle-demo.example');await page.getByRole('textbox',{name:'Password',exact:true}).fill('Local-test-only-123!');await page.getByRole('button',{name:/Sign in|Login/i}).click()
  await page.getByPlaceholder('Search invoice or customer',{exact:true}).fill(order.orderNumber)
  await page.getByRole('button',{name:'Start Preparing',exact:true}).click()
  await page.getByRole('checkbox',{name:'Pending '+name,exact:true}).click()
  await expect(page.getByRole('checkbox',{name:'Done '+name,exact:true})).toBeChecked({timeout:20000})
  await expect(page.getByRole('button',{name:'Mark Ready',exact:true})).toBeEnabled({timeout:20000})
  await page.getByRole('button',{name:'Mark Ready',exact:true}).click();await page.getByRole('button',{name:'Back to Operation',exact:true}).click()
  await page.getByRole('button',{name:'Create Delivery',exact:true}).click()
  const dialog=page.getByRole('dialog');await dialog.getByPlaceholder('Search order number, customer...',{exact:true}).fill(order.orderNumber)
  await dialog.getByRole('checkbox',{name:'Select order '+order.orderNumber,exact:true}).check()
  await dialog.getByRole('textbox',{name:/^Receiver Name/}).fill('UI Courier '+suffix);await dialog.getByRole('textbox',{name:/^Phone Number/}).fill('099123456')
  await dialog.getByRole('button',{name:'Next',exact:true}).click()
  const canvas=dialog.locator('canvas[aria-label="Receiver Received Signature pad"]'),bounds=await canvas.boundingBox();expect(bounds).toBeTruthy()
  await page.mouse.move(bounds.x+25,bounds.y+45);await page.mouse.down();await page.mouse.move(bounds.x+90,bounds.y+70,{steps:8});await page.mouse.move(bounds.x+140,bounds.y+35,{steps:8});await page.mouse.up()
  await dialog.getByRole('button',{name:'Next',exact:true}).click();await expect(dialog.getByRole('img',{name:'Receiver received signature',exact:true})).toBeVisible()
  await page.screenshot({path:'docs/screenshots/retails-delivery-confirm-mobile.png',fullPage:true})
  await page.route('**/delivery-handovers',async(route)=>{if(route.request().method()!=='POST'){await route.continue();return}keys.push(route.request().headers()['idempotency-key']);attempts++;if(attempts===1){const response=await route.fetch();expect(response.status()).toBe(201);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Delivery response interrupted. Retry.'})});return}await route.continue()})
  await dialog.getByRole('button',{name:'Create Delivery',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Delivery response interrupted.')
  await dialog.getByRole('button',{name:'Create Delivery',exact:true}).click();await expect(dialog).toHaveCount(0,{timeout:20000});expect(keys).toHaveLength(2);expect(keys[1]).toBe(keys[0])
  const detail=(await (await request.get(api+'orders/'+order.id,{headers:auth})).json()).order;expect(detail.fulfillmentStatus).toBe('completed');expect(detail.collectionArrangement).toBe('COD');expect(detail.codCollectAmount).toBe(5000)
  const delivery=(await (await request.get(api+'delivery-handovers/'+detail.deliveryMembership.handoverId,{headers:auth})).json()).handover
  expect(delivery.receiverName).toBe('UI Courier '+suffix);expect(delivery.orders).toHaveLength(1);expect(delivery.orders[0].snapshot.customer.name).toBe(customer.name);expect(delivery.orders[0].snapshot.codPending).toBe(5000);expect(delivery.signatureDataUrl).toMatch(/^data:image\/png;base64,/)
  expect((await (await request.get(api+'products/'+product.id,{headers:auth})).json()).product.currentStock).toBe(2)
  await page.getByPlaceholder('Search invoice or customer',{exact:true}).fill(delivery.deliveryNumber);await expect(page.getByText(delivery.deliveryNumber,{exact:true})).toBeVisible({timeout:20000})
  await page.reload();await expect(page.getByText(delivery.deliveryNumber,{exact:true})).toBeVisible({timeout:20000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();expect(errors).toEqual([])
  await page.screenshot({path:'docs/screenshots/retails-delivery-done-mobile.png',fullPage:true})
  await page.getByRole('button',{name:'Open',exact:true}).click()
  const savedDialog=page.getByRole('dialog')
  await expect(savedDialog.getByText('UI Courier '+suffix,{exact:true}).first()).toBeVisible({timeout:20000})
  await expect(savedDialog.getByText('Demo Belle Owner',{exact:true})).toBeVisible()
  await expect(savedDialog.getByRole('img',{name:'Receiver received signature',exact:true})).toHaveAttribute('src',delivery.signatureDataUrl)
  await savedDialog.getByRole('button').filter({has:page.getByTestId('way-invoice-arrow-'+order.id)}).click()
  await expect(savedDialog.getByText(name,{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();expect(errors).toEqual([])
  await page.screenshot({path:'docs/screenshots/retails-delivery-details-mobile.png',fullPage:true})
})
