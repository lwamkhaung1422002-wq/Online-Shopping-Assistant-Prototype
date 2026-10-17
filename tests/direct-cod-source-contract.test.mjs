import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {createPosCodReceipts} from '../../BelleLocal POS app/functions/src/pos/cod-receipts.js'
import {digest} from '../../BelleLocal POS app/src/shared/pos-domain/mutation.js'
if(process.env.DIRECT_FIRESTORE_EMULATOR!=='127.0.0.1:8088')throw Error('Use the isolated direct emulator.')
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8088'
const require=createRequire(new URL('../../BelleLocal POS app/functions/package.json',import.meta.url))
const{initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore')
const app=initializeApp({projectId:'demo-belle-direct-cod-source'},'direct-cod-source'),db=getFirestore(app),shop='cod-source-contract'
test.before(async()=>{
  const response=await fetch('http://127.0.0.1:8088/emulator/v1/projects/demo-belle-direct-cod-source/databases/(default)/documents',{method:'DELETE'})
  assert.equal(response.ok,true)
})
test.after(()=>deleteApp(app))
const table=name=>db.collection(`onlineShopV2/${shop}/${name}`)
test('shared extraction retains reference 500-invoice receipt/reversal, raw JSON fingerprint and immutable correction contract',async()=>{
  // Admin emulator exercises the extracted source engine, not browser Rules or
  // the unfinished direct settlement writer. This project has no Main records.
  const writer=db.bulkWriter(),allocations=[]
  writer.set(table('pos_settings').doc('main'),{paymentMethods:[]})
  for(let i=0;i<500;i++){
    const id=`invoice-${i}`
    writer.set(table('pos_orders').doc(id),{id,total:100,subtotal:100,discount:0,items:[],saleType:'ONLINE',collectionArrangement:'COD',fulfillmentStatus:'completed',cancellationState:null,paymentStatus:'unpaid',codCollectAmount:100})
    writer.set(table('pos_delivery_memberships').doc(id),{orderId:id})
    allocations.push({orderId:id,expectedBalance:100})
  }
  await writer.close()
  const body={receivingMethod:'Cash',statementNumber:'123456',transactionId:'654321',paymentDate:'2026-07-23',amount:50000,allocations},key='source-contract-key-001',cod=createPosCodReceipts({db,now:()=>Date.parse('2026-07-24T00:00:00.000Z')})
  const received=await cod.receive(shop,body,'owner',key)
  assert.equal(received.settlement.allocations.length,500)
  const expected=createHash('sha256').update(JSON.stringify({...body,allocations:[...allocations].sort((a,b)=>a.orderId.localeCompare(b.orderId))})).digest('hex')
  assert.equal(received.settlement.requestFingerprint,expected)
  assert.equal((await cod.receive(shop,body,'owner',key)).replayed,true)
  assert.equal((await table('pos_cod_keys').doc(digest(key)).get()).data().settlementId,received.settlement.id)
  const originals=(await table('pos_payments').get()).docs.map(row=>[row.id,row.data()])
  assert.equal(originals.length,500)
  const reversed=await cod.reverse(shop,received.settlement.id,{reason:'Statement correction'},'owner','source-reversal-key-001')
  assert.equal(reversed.replayed,false)
  assert.equal((await cod.reverse(shop,received.settlement.id,{reason:'Statement correction'},'owner','source-reversal-key-001')).replayed,true)
  for(const[id,value]of originals)assert.deepEqual((await table('pos_payments').doc(id).get()).data(),value)
  const payments=(await table('pos_payments').get()).docs.map(row=>row.data())
  assert.equal(payments.length,1000);assert.equal(payments.reduce((total,row)=>total+row.amount,0),0)
  assert.equal((await table('pos_orders').doc('invoice-0').get()).data().codCollectAmount,100)
})
