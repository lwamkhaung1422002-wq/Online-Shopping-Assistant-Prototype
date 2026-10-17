import {test,expect} from '@playwright/test'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {signatureFixture} from '../handover-signature-fixture.mjs'

test('linked invoice opens one payable, desktop edits persist with rollback feedback and supplier removal retains invoice history on mobile',async({page,request})=>{
  test.setTimeout(120000)
  process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
  const require=createRequire(new URL('../../../BelleLocal POS app/functions/package.json',import.meta.url))
  const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore')
  const db=getFirestore(initializeApp({projectId:'demo-belle-online'},'supplier-links-browser-'+randomUUID()))
  const suffix=randomUUID().slice(0,8),supplierId=randomUUID(),name='Linked invoice '+suffix,date=new Date().toISOString(),invoice='LI-'+suffix
  // POST Supplier in the source creates an unlinked delivery invoice. Only the
  // pre-existing Supplier identity is seeded; linked invoice and payable are
  // produced through their actual owner HTTP writers.
  await db.doc(`onlineShopV2/belle-online/pos_suppliers/${supplierId}`).set({id:supplierId,shopId:'belle-online',name,isActive:true,phone:'099111111',notes:'Keep contact note',createdAt:date,updatedAt:date})
  const login=await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{data:{email:'owner@belle-demo.example',password:'Local-test-only-123!',returnSecureToken:true}});expect(login.ok()).toBeTruthy()
  const headers={Authorization:'Bearer '+(await login.json()).idToken},api='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
  const receivedAt=date.slice(0,10),dueAt='2026-10-25',body={deliveryRecord:{invoiceNumber:invoice,deliveryName:'Actual delivery',deliveryPhone:'099222222',receivedAt,dueAt,amount:50000}}
  const linked=await request.patch(api+'suppliers/'+supplierId,{headers,data:body});expect(linked.status()).toBe(200)
  const supplier=(await (await request.get(api+'suppliers?search='+encodeURIComponent(name),{headers})).json()).suppliers.find(row=>row.id===supplierId),delivery=supplier.deliveryRecords[0]
  const opened=await request.post(api+'supplier-delivery-records/'+delivery.id+'/payable-purchase',{headers,data:{}});expect(opened.status()).toBe(201);const purchase=(await opened.json()).purchase
  expect(purchase.status).toBe('received');expect(purchase.items).toEqual([]);expect(purchase.receipts).toEqual([])
  expect((await (await request.post(api+'supplier-delivery-records/'+delivery.id+'/payable-purchase',{headers,data:{}})).json()).purchase.id).toBe(purchase.id)
  const originals={};for(const collection of ['orders','payments','expenses','stocks','stockAdjustments','audit','catalog','paymentReferences','meta']){
    const reference=db.doc(`users/demo-owner/${collection}/linked-browser-${suffix}`),data={amount:34500,status:'reserved',paymentStatus:'unpaid',source:collection};await reference.set(data);originals[reference.path]=data
  }
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:1365,height:950});await page.goto('http://127.0.0.1:5176/#/suppliers')
  await page.getByRole('button',{name:'Use demo account',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).click()
  const search=page.getByPlaceholder('Search suppliers by name or invoice number',{exact:true});await expect(search).toBeVisible({timeout:20000});await search.fill(purchase.purchaseNumber)
  await expect(page.getByText('1 Suppliers',{exact:true})).toBeVisible({timeout:20000});await page.getByRole('button',{name:'Edit '+name,exact:true}).click()
  await expect(page.getByPlaceholder('Enter delivery name',{exact:true})).toHaveValue('Actual delivery')
  await expect(page.getByPlaceholder('Enter phone number',{exact:true})).toHaveValue('099111111');await expect(page.getByPlaceholder('Enter invoice number',{exact:true})).toHaveValue(invoice)
  const editedName=name+' edited';await page.getByRole('combobox',{name:'Enter supplier name',exact:true}).fill(editedName);await page.getByPlaceholder('Enter amount',{exact:true}).fill('49000')
  await page.getByRole('button',{name:'Save Supplier',exact:true}).click();await expect(page.getByText('Amount cannot be reduced below the original created amount.',{exact:true})).toBeVisible();expect((await db.doc(`onlineShopV2/belle-online/pos_suppliers/${supplierId}`).get()).data().name).toBe(name)
  await page.getByPlaceholder('Enter amount',{exact:true}).fill('60000');await page.getByPlaceholder('Enter delivery name',{exact:true}).fill('Edited delivery')
  await page.screenshot({path:'docs/screenshots/retails-linked-supplier-edit.png',fullPage:true});await page.getByRole('button',{name:'Save Supplier',exact:true}).click();await expect(search).toBeVisible({timeout:20000});await search.fill(purchase.purchaseNumber)
  await expect(page.getByText(editedName,{exact:true})).toBeVisible();await page.reload();await expect(search).toBeVisible({timeout:20000});await search.fill(purchase.purchaseNumber);await expect(page.getByText(editedName,{exact:true})).toBeVisible({timeout:20000})
  const updated=(await db.doc(`onlineShopV2/belle-online/pos_suppliers/${supplierId}`).get()).data();expect(updated.notes).toBe('Keep contact note')
  const invoiceAfterEdit=(await db.doc(`onlineShopV2/belle-online/pos_supplier_delivery_records/${delivery.id}`).get()).data();expect(invoiceAfterEdit.amount).toBe(60000);expect(invoiceAfterEdit.receiverName).toBe(delivery.receiverName);expect(invoiceAfterEdit.supplierName).toBe(name)
  expect((await db.doc(`onlineShopV2/belle-online/pos_purchases/${purchase.id}`).get()).data().total).toBe(50000)
  await page.getByRole('button',{name:'Delete '+editedName,exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:'Cancel Invoice Reason',exact:false}).fill('Remove unused supplier')
  await dialog.getByRole('button',{name:'Cancel Invoice',exact:true}).click();await expect(dialog).toHaveCount(0,{timeout:20000});await expect(page.getByText('0 Suppliers',{exact:true})).toBeVisible({timeout:20000})
  expect((await db.doc(`onlineShopV2/belle-online/pos_suppliers/${supplierId}`).get()).exists).toBe(false);expect((await db.doc(`onlineShopV2/belle-online/pos_purchases/${purchase.id}`).get()).exists).toBe(false)
  expect((await db.doc(`onlineShopV2/belle-online/pos_deleted_supplier_records/${supplierId}`).get()).exists).toBe(true);const archived=(await db.doc(`onlineShopV2/belle-online/pos_deleted_purchase_records/${purchase.id}`).get()).data();expect(archived.purchase.total).toBe(50000)
  const detached=(await db.doc(`onlineShopV2/belle-online/pos_supplier_delivery_records/${delivery.id}`).get()).data();expect(detached.supplierId).toBeNull();expect(detached.status).toBe('active')
  await page.setViewportSize({width:390,height:844});await page.reload();const mobileSearch=page.getByRole('textbox',{name:'Search suppliers by name or invoice number',exact:true});await expect(mobileSearch).toBeVisible({timeout:20000});await mobileSearch.fill(invoice)
  await expect(page.getByText('1 Suppliers',{exact:true})).toBeVisible({timeout:20000});await expect(page.getByText(invoice,{exact:true})).toBeVisible();await expect(page.getByText(name,{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy()
  await page.screenshot({path:'docs/screenshots/retails-detached-supplier-invoice-mobile.png',fullPage:true})
  for(const [path,original] of Object.entries(originals))expect((await db.doc(path).get()).data()).toEqual(original)
  expect(errors).toEqual([])
})

test('desktop removal reports the purchase payment-history guard without losing original receipts or supplier identity',async({page,request})=>{
  test.setTimeout(60000)
  process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
  const require=createRequire(new URL('../../../BelleLocal POS app/functions/package.json',import.meta.url))
  const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore')
  const db=getFirestore(initializeApp({projectId:'demo-belle-online'},'supplier-delete-guard-browser-'+randomUUID()))
  const suffix=randomUUID().slice(0,8),supplierId=randomUUID(),name='Supplier history guard '+suffix,date=new Date().toISOString()
  await db.doc(`onlineShopV2/belle-online/pos_suppliers/${supplierId}`).set({id:supplierId,shopId:'belle-online',name,isActive:true,phone:'099333333',createdAt:date,updatedAt:date})
  const login=await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{data:{email:'owner@belle-demo.example',password:'Local-test-only-123!',returnSecureToken:true}});expect(login.ok()).toBeTruthy()
  const headers={Authorization:'Bearer '+(await login.json()).idToken},api='http://127.0.0.1:5001/demo-belle-online/asia-southeast1/onlineShopApi/belle-online/admin/pos/'
  expect((await request.patch(api+'suppliers/'+supplierId,{headers,data:{deliveryRecord:{invoiceNumber:'GUARD-'+suffix,deliveryName:'Delivery with history',deliveryPhone:'099444444',receivedAt:date.slice(0,10),dueAt:'2026-10-25',amount:50000}}})).status()).toBe(200)
  const supplier=(await (await request.get(api+'suppliers?search='+encodeURIComponent(name),{headers})).json()).suppliers.find(row=>row.id===supplierId),delivery=supplier.deliveryRecords[0]
  const opened=await request.post(api+'supplier-delivery-records/'+delivery.id+'/payable-purchase',{headers,data:{}});expect(opened.status()).toBe(201);const purchase=(await opened.json()).purchase
  const paid=await request.post(api+'purchases/'+purchase.id+'/payments',{headers:{...headers,'Idempotency-Key':randomUUID()},data:{amount:50000,method:'Cash',payerName:'Guard receiver',signatureDataUrl:signatureFixture()}});expect(paid.status()).toBe(201);const receipt=(await paid.json()).purchase.payments[0]
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:1365,height:950});await page.goto('http://127.0.0.1:5176/#/suppliers');await page.getByRole('button',{name:'Use demo account',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).click()
  const search=page.getByPlaceholder('Search suppliers by name or invoice number',{exact:true});await expect(search).toBeVisible({timeout:20000});await search.fill(purchase.purchaseNumber)
  await expect(page.getByText('1 Suppliers',{exact:true})).toBeVisible({timeout:20000});await page.getByRole('button',{name:'Delete '+name,exact:true}).click()
  const dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:'Cancel Invoice Reason',exact:false}).fill('Attempt to delete paid history');await dialog.getByRole('button',{name:'Cancel Invoice',exact:true}).click()
  await expect(dialog.getByRole('alert')).toHaveText('Suppliers with payment records cannot be deleted.');await expect(dialog.getByRole('button',{name:'Cancel Invoice',exact:true})).toBeEnabled()
  expect((await db.doc(`onlineShopV2/belle-online/pos_purchase_payments/${receipt.id}`).get()).data()).toEqual(receipt);expect((await db.doc(`onlineShopV2/belle-online/pos_suppliers/${supplierId}`).get()).exists).toBe(true);expect((await db.doc(`onlineShopV2/belle-online/pos_deleted_supplier_records/${supplierId}`).get()).exists).toBe(false)
  await page.screenshot({path:'docs/screenshots/retails-supplier-delete-payment-guard.png',fullPage:true});await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);expect(errors).toEqual([])
})
