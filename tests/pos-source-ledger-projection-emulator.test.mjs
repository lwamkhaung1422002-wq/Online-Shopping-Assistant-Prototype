import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {createPosCatalog} from '../../BelleLocal POS app/functions/src/pos/catalog.js'
import {createStockLedger,stockScopeKey} from '../../BelleLocal POS app/functions/src/pos/stock-ledger.js'
import {createPosOrders} from '../../BelleLocal POS app/functions/src/pos/orders.js'
import {createPosInventoryAdjustments} from '../../BelleLocal POS app/functions/src/pos/inventory-adjustments.js'
import {createPosLocations} from '../../BelleLocal POS app/functions/src/pos/locations.js'
import {createPosStoreConfiguration} from '../../BelleLocal POS app/functions/src/pos/store-configuration.js'

if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Source ledger projection requires isolated loopback emulators.')
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url)),{initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore')
initializeApp({projectId:'demo-belle-online'});const db=getFirestore(),owner='source-ledger-'+randomUUID(),catalog=createPosCatalog({db}),ledger=createStockLedger({db}),orders=createPosOrders({db}),locations=createPosLocations({db}),adjustments=createPosInventoryAdjustments({db,ownerUid:owner}),config=createPosStoreConfiguration({db,ownerUid:owner}),table=(shop,name)=>db.collection(`onlineShopV2/${shop}/${name}`),rows=async(shop,name)=>(await table(shop,name).get()).docs.map(row=>({...row.data(),id:row.id})),names=['stock_batches','stock_balances','stock_movements','stock_reservations','pos_products','stock_requests','pos_audit','pos_settings','pos_orders','pos_payments'],state=async shop=>Object.fromEntries(await Promise.all(names.map(async name=>[name,await rows(shop,name)])))
async function fixture(){const shop='source-projection-'+randomUUID(),product=await catalog.create(shop,{name:'Projection item',price:500,cost:100,units:[{name:'Piece',isBase:true,conversionFactor:1}],openingStock:{quantity:1,unitCost:100}},owner,randomUUID());return {shop,product}}

test('Coordinated disabled-ledger receipt lines freeze one source balance, share physical stock with POS, preserve source movement visibility and refuse divergent cutover without repairs',async()=>{
 const f=await fixture(),target=table(f.shop,'stock_balances').doc(stockScopeKey(f.product.id)),original=(await target.get()).data();await table(f.shop,'pos_settings').doc('main').set({ledgerEnabled:false})
 const entries=[{body:{productId:f.product.id,quantity:2,unitCost:150},requestKey:randomUUID()},{body:{productId:f.product.id,quantity:3,unitCost:200},requestKey:randomUUID()}]
 await ledger.receiveReceiptGroup(f.shop,entries,owner);const received=(await target.get()).data();assert.equal(received.onHand,'6');assert.equal(received.sourceLedger.onHand,'1');assert.equal(received.sourceLedger.version,original.version);assert.equal(received.sourceLedger.updatedAt,original.updatedAt);assert.equal((await locations.balances(f.shop)).balances[0].onHand,'1');assert.equal((await catalog.get(f.shop,f.product.id)).product.availableStock,6);assert.equal((await catalog.get(f.shop,f.product.id)).product.cost,167);assert.equal((await catalog.movements(f.shop)).totalCount,1)
 const once=await state(f.shop);await ledger.receiveReceiptGroup(f.shop,entries,owner);assert.deepEqual(await state(f.shop),once)
 await orders.create(f.shop,{saleType:'IN_STORE',paymentMode:'FULL',initialPayment:{method:'Cash',amount:1000},items:[{productId:f.product.id,quantity:2}]},owner,randomUUID(),{checkout:true});assert.equal((await target.get()).data().onHand,'4');assert.equal((await target.get()).data().sourceLedger.onHand,'1');assert.equal((await catalog.movements(f.shop)).totalCount,1)
 await table(f.shop,'pos_settings').doc('main').set({ledgerEnabled:true});await ledger.receive(f.shop,{productId:f.product.id,quantity:2,unitCost:100},owner,randomUUID());const later=(await target.get()).data();assert.equal(later.onHand,'6');assert.equal(later.sourceLedger.onHand,'3');assert.equal(later.sourceLedger.version,original.version+1);assert.equal((await locations.balances(f.shop)).balances[0].onHand,'3');assert.equal((await catalog.movements(f.shop)).totalCount,2)
 const unchanged=await state(f.shop);await assert.rejects(config.mode(f.shop,{mode:'LEDGER'},owner),error=>error.status===409);assert.deepEqual(await state(f.shop),unchanged)
 await table(f.shop,'pos_settings').doc('main').set({ledgerEnabled:false});await target.update({sourceLedger:{onHand:'0',reserved:'1',version:1}});const invalid=await state(f.shop);await assert.rejects(ledger.receive(f.shop,{productId:f.product.id,quantity:1,unitCost:100},owner,randomUUID()),error=>error.status===409);assert.deepEqual(await state(f.shop),invalid)
})

test('Decreasing the final unheld ordinary unit records a zero weighted cost and freezes enabled/disabled source balances without NaN or extra financial records',async()=>{
 for(const enabled of [true,false]){const f=await fixture();await table(f.shop,'pos_settings').doc('main').set({ledgerEnabled:enabled});const result=await adjustments.byCost(f.shop,{productId:f.product.id,unitCost:100,quantity:1,reason:'Final unit no longer present'},owner,randomUUID()),balance=(await table(f.shop,'stock_balances').doc(stockScopeKey(f.product.id)).get()).data(),product=(await table(f.shop,'pos_products').doc(f.product.id).get()).data();assert.equal(result.availableQuantity,1);assert.equal(balance.onHand,'0');assert.equal(product.cost,0);assert.equal((await rows(f.shop,'pos_orders')).length,0);assert.equal((await rows(f.shop,'pos_payments')).length,0);assert.equal((await catalog.movements(f.shop)).totalCount,enabled?2:1);if(!enabled){assert.equal(balance.sourceLedger.onHand,'1');assert.equal((await adjustments.history(f.shop,owner)).adjustments.length,1)}}
})
