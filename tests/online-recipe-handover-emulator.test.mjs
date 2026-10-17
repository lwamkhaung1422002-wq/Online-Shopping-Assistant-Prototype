import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {publicRecipeFixture} from './public-recipe-fixture.mjs'
import {createOrderService} from '../../BelleLocal POS app/functions/src/online-shop/orders.js'
import {createPosOrders} from '../../BelleLocal POS app/functions/src/pos/orders.js'
import {createPosOperations} from '../../BelleLocal POS app/functions/src/pos/operations.js'
import {createPosCancellation} from '../../BelleLocal POS app/functions/src/pos/cancellation.js'
import {createPosInventoryReceipts} from '../../BelleLocal POS app/functions/src/pos/inventory-receipts.js'
import {publicProduct} from '../../BelleLocal POS app/functions/src/online-shop/domain.js'
import {stockScopeKey} from '../../BelleLocal POS app/functions/src/pos/stock-ledger.js'
import {signatureFixture} from './handover-signature-fixture.mjs'
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Public recipe tests require isolated loopback Firebase emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url)),{initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore')
initializeApp({projectId:'demo-belle-online'});const db=getFirestore(),guest=createOrderService({db,checkoutEnabled:true}),pos=createPosOrders({db}),operations=createPosOperations({db,getCreatorName:async()=> 'Demo Belle Owner'}),cancel=createPosCancellation({db})
const rows=async(f,name)=>(await f.table(name).get()).docs.map(row=>({...row.data(),id:row.id})).sort((a,b)=>a.id.localeCompare(b.id)),balance=async f=>(await f.table('stock_balances').doc(stockScopeKey(f.ingredient.id)).get()).data(),saved=async(f,request)=>(await f.table('orders').doc(request.request_key).get()).data()
const names=['orders','pos_orders','pos_payments','stock_balances','stock_batches','stock_reservations','stock_requests','pos_recipe_stock_scopes','pos_recipe_requirements','pos_recipe_consumptions','pos_requests','pos_audit','pos_order_numbers','pos_shop_meta','pos_customers','pos_order_operations','inventory_movements','pos_serial_guest_holds','pos_serial_guest_reservations','pos_serial_allocations','pos_inventory_serials'],state=async f=>Object.fromEntries(await Promise.all(names.map(async name=>[name,await rows(f,name)])))
async function accept(f,request){const tracking=await guest.checkout(f.shop,request);await guest.transition(f.shop,request.request_key,{status:'confirmed'},'demo-owner');return tracking}
const handover=(f,request,choices={paymentMode:'COD'})=>pos.handover(f.shop,request.request_key,choices,'demo-owner',randomUUID())
async function deliver(f,order){await operations.advance(f.shop,order.id,'start','demo-owner');for(const item of order.items)await operations.setPrepared(f.shop,order.id,item.id,{prepared:true},'demo-owner');await operations.advance(f.shop,order.id,'ready','demo-owner');return operations.createDelivery(f.shop,{orderIds:[order.id],receiverName:'Public recipe courier',receiverPhone:'Private courier phone',signatureDataUrl:signatureFixture(),verifiedItems:order.items.map(item=>({orderItemId:item.id,quantity:item.enteredQuantity,unit:item.pricingSnapshot.unitSymbol??''}))},'demo-owner',randomUUID())}

test('Public recipe quote exposes choices and real ingredient capacity, rejects missing/foreign options and shortages atomically',async()=>{
 const f=await publicRecipeFixture(db),projected=(await f.stock.project(f.shop,[f.publicProduct]))[0],safe=publicProduct({...projected,variants:projected.variants.map(variant=>({...variant,recipe:{...variant.recipe,yieldQuantity:2,ingredientProductId:f.ingredient.id,modifier_groups:variant.recipe.modifier_groups.map(group=>({...group,ingredientDelta:'private',options:group.options.map(option=>({...option,unitCost:50,ingredientDelta:[f.ingredient.id]}))}))}}))},[],[])
 assert.equal(safe.variants[0].available,2);assert.equal(safe.variants[0].recipe.modifier_groups[0].name,'Recipe choice');for(const field of ['ingredientDelta','ingredientProductId','unitCost','yieldQuantity',f.ingredient.id])assert.equal(JSON.stringify(safe).includes(field),false)
 assert.deepEqual(await f.stock.quote(f.shop,f.publicProduct.variants[0].id,[f.less.id]),{variant_id:f.publicProduct.variants[0].id,price:1000,available:3});assert.equal((await f.stock.quote(f.shop,f.publicProduct.variants[0].id,[f.extra.id])).available,1)
 const before=await state(f);await assert.rejects(guest.checkout(f.shop,f.request([f.line(1,[])])),/requires between/);await assert.rejects(guest.checkout(f.shop,f.request([f.line(1,[randomUUID()])])),/another menu item/);await assert.rejects(guest.checkout(f.shop,f.request([f.line(4)])),/short by 1/);assert.deepEqual(await state(f),before)
 const request=f.request([f.line(3)]);await guest.checkout(f.shop,request);await guest.checkout(f.shop,request);assert.equal((await balance(f)).reserved,'3');assert.equal((await rows(f,'orders')).length,1);assert.equal((await f.stock.quote(f.shop,f.publicProduct.variants[0].id,[f.less.id])).available,0);assert.equal((await rows(f,'stock_reservations')).length,1)
})

test('Mixed recipe and ordinary ingredient sales share one atomic hold; failed carts roll back and POS cancellation releases both exactly once',async()=>{
 const f=await publicRecipeFixture(db),ordinary=quantity=>({variant_id:f.ordinary.variants[0].id,quantity,measurements:{}}),before=await state(f)
 await assert.rejects(guest.checkout(f.shop,f.request([f.line(2),ordinary(2)])),/short by/);assert.deepEqual(await state(f),before)
 const request=f.request([f.line(),ordinary(1)]),tracking=await accept(f,request);assert.equal((await balance(f)).reserved,'2');const order=(await handover(f,request)).order;assert.equal(order.total,1500);assert.equal((await balance(f)).reserved,'2');assert.equal((await rows(f,'stock_reservations')).filter(row=>row.status==='ACTIVE').length,2)
 await cancel.cancel(f.shop,order.id,{reason:'Cancel before delivery'},'demo-owner');assert.equal((await balance(f)).reserved,'0');assert.equal((await balance(f)).onHand,'3');assert.equal((await guest.track(f.shop,tracking)).status,'cancelled');const once=await state(f);await guest.transition(f.shop,request.request_key,{status:'cancelled'},'demo-owner');assert.deepEqual(await state(f),once)
})

test('Different choices on one public variant create one POS invoice with frozen modifiers/prices, transfer holds without another reservation and consume on delivery',async()=>{
 const f=await publicRecipeFixture(db),request=f.request([f.line(1,[f.less.id]),f.line(1,[f.extra.id])]),tracking=await accept(f,request),source=await saved(f,request),batches=await rows(f,'stock_batches'),legacyRef=db.doc(`users/demo-owner/orders/${randomUUID()}`)
 await legacyRef.set({original:true,total:34500});assert.equal(source.total,2200);assert.equal(source.stock_reservations.length,0);assert.equal(source.recipe_stock_reservations.length,1);assert.equal((await balance(f)).reserved,'3')
 const results=await Promise.all([handover(f,request),handover(f,request)]),order=results[0].order;assert.equal(results[1].order.id,order.id);assert.equal(results.filter(result=>!result.replayed).length,1);assert.equal(order.total,2200);assert.deepEqual(order.items.map(item=>item.unitPrice).sort(),[1000,1100]);assert.deepEqual(order.items.map(item=>item.modifierSelections[0].optionName).sort(),['Extra ingredient','Less ingredient']);assert.deepEqual(await rows(f,'stock_batches'),batches);assert.equal((await balance(f)).reserved,'3')
 const requirements=await rows(f,'pos_recipe_requirements');assert.equal(requirements.filter(row=>row.orderId===request.request_key&&row.status==='TRANSFERRED').length,4);assert.equal(requirements.filter(row=>row.orderId===order.id&&row.status==='ACTIVE').length,4);assert.equal(new Set(requirements.map(row=>row.id)).size,8)
 const tracked=await guest.track(f.shop,tracking);assert.equal(tracked.items[0].modifiers.length,1);for(const word of ['ingredientDelta','recipe_snapshot','stock_scope_key','unitCost',f.ingredient.id,'Private recipe'])assert.equal(JSON.stringify(tracked).includes(word),false)
 await deliver(f,order);assert.equal((await balance(f)).onHand,'0');assert.equal((await balance(f)).reserved,'0');assert.equal((await guest.track(f.shop,tracking)).status,'shipped');assert.equal((await rows(f,'pos_recipe_consumptions')).filter(row=>row.orderId===order.id).length,1);assert.deepEqual((await legacyRef.get()).data(),{original:true,total:34500})
})

test('Public cancel/reject/expiry release ingredient holds; confirmed orders survive ageing and corrupt handovers roll back',async()=>{
 for(const status of ['cancelled','rejected','expired']){const f=await publicRecipeFixture(db),request=f.request();await guest.checkout(f.shop,request);if(status==='expired'){await f.table('orders').doc(request.request_key).update({expires_at:'2020-01-01T00:00:00.000Z'});assert.equal((await guest.expire(f.shop,'system:maintenance')).expired,1)}else await guest.transition(f.shop,request.request_key,{status},'demo-owner');assert.equal((await balance(f)).reserved,'0');assert.equal((await balance(f)).onHand,'3')}
 const f=await publicRecipeFixture(db),request=f.request();await accept(f,request);await f.table('orders').doc(request.request_key).update({expires_at:'2020-01-01T00:00:00.000Z'});assert.equal((await guest.expire(f.shop,'system:maintenance')).expired,0)
 const scope=(await rows(f,'pos_recipe_stock_scopes'))[0];await f.table('pos_recipe_stock_scopes').doc(scope.id).update({allocations:scope.allocations.map(row=>({...row,baseQuantity:'2'}))});const before=await state(f);await assert.rejects(handover(f,request),/recipe stock evidence requires reconciliation/);assert.deepEqual(await state(f),before)
})

test('Changed recipe definitions retain accepted modifier evidence and source current-component fulfillment, without repricing',async()=>{
 const f=await publicRecipeFixture(db),request=f.request([f.line(2)]);await accept(f,request)
 await f.recipes.replace(f.shop,f.menu.id,{yieldQuantity:2,components:[{ingredientProductId:f.ingredient.id,quantity:2}],modifierGroups:[]},'demo-owner');await f.table('products').doc(f.publicProduct.id).update({variants:f.publicProduct.variants.map(variant=>({...variant,price:9999}))})
 const order=(await handover(f,request)).order;assert.equal(order.total,2100);assert.equal(order.items[0].unitPrice,1000);assert.equal(order.items[0].modifierSelections[0].modifierOptionId,null);assert.equal(order.items[0].modifierSelections[0].ingredientDelta[0].quantity,-.5);assert.equal((await balance(f)).reserved,'2');await deliver(f,order);assert.equal((await balance(f)).onHand,'2');assert.equal((await balance(f)).reserved,'0')
})

test('SERIAL recipe menus let the owner select identities at handover while ingredient holds remain shared and source identities stay RESERVED until cancellation',async()=>{
 const f=await publicRecipeFixture(db,undefined,{serial:true}),receipts=createPosInventoryReceipts({db});await receipts.receive(f.shop,{productId:f.menu.id,unitId:f.menu.units[0].unitId,locationId:'main',enteredQuantity:2,unitCost:77,reason:'Menu identity producer',serials:[{serial:randomUUID()},{serial:randomUUID()}]},'demo-owner',randomUUID())
 assert.equal((await f.stock.quote(f.shop,f.publicProduct.variants[0].id,[f.less.id])).available,2)
 const request=f.request();await accept(f,request);const before=await state(f),original=await saved(f,request),reservedId=original.items[0].serial_reservation_ids[0]
 await assert.rejects(pos.create(f.shop,{fulfillmentStatus:'reserved',items:[{productId:f.menu.id,quantity:1,serialIds:[reservedId],modifierOptionIds:[f.less.id]}]},'demo-owner',randomUUID()),/reserved by an online order/);assert.deepEqual(await state(f),before)
 const options=await f.stock.handoverOptions(f.shop,request.request_key),chosen=options.items[0].serials[0].id,order=(await handover(f,request,{paymentMode:'COD',serialSelections:[{onlineItemId:options.items[0].online_item_id,serialIds:[chosen]}]})).order
 assert.equal((await f.table('pos_inventory_serials').doc(chosen).get()).data().status,'RESERVED');assert.equal((await balance(f)).reserved,'1');await cancel.cancel(f.shop,order.id,{reason:'Unshipped serial recipe cancellation'},'demo-owner');assert.equal((await f.table('pos_inventory_serials').doc(chosen).get()).data().status,'IN_STOCK');assert.equal((await balance(f)).reserved,'0');assert.equal((await rows(f,'pos_serial_allocations')).length,1)
})

test('Serial guest reservations reject overbooking, serialize with POS identity selection and preserve cancelled guest evidence for later reuse',async()=>{
 const f=await publicRecipeFixture(db,undefined,{serial:true}),receipts=createPosInventoryReceipts({db});await receipts.receive(f.shop,{productId:f.menu.id,unitId:f.menu.units[0].unitId,locationId:'main',enteredQuantity:2,unitCost:77,reason:'Guest serial race',serials:[{serial:randomUUID()},{serial:randomUUID()}]},'demo-owner',randomUUID())
 const request=f.request([f.line(1,[f.less.id]),f.line(1,[f.extra.id])]);await guest.checkout(f.shop,request);const first=await saved(f,request);assert.equal(new Set(first.items.flatMap(item=>item.serial_reservation_ids)).size,2);const before=await state(f);await assert.rejects(guest.checkout(f.shop,f.request()),/available serial stock/);assert.deepEqual(await state(f),before)
 await guest.transition(f.shop,request.request_key,{status:'cancelled'},'demo-owner');const released=await rows(f,'pos_serial_guest_reservations');assert.equal(released.length,2);assert.ok(released.every(row=>row.status==='RELEASED'));assert.equal((await balance(f)).reserved,'0')
 const lowest=(await rows(f,'pos_inventory_serials'))[0].id,competing=f.request([f.line(2)]),results=await Promise.allSettled([guest.checkout(f.shop,competing),pos.create(f.shop,{fulfillmentStatus:'reserved',items:[{productId:f.menu.id,quantity:1,serialIds:[lowest],modifierOptionIds:[f.less.id]}]},'demo-owner',randomUUID())]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1)
 const records=await rows(f,'pos_serial_guest_reservations');for(const old of released)assert.deepEqual(records.find(row=>row.id===old.id),old)
})
