import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import {createCodMutationPlanner} from '../../BelleLocal POS app/src/features/firebase-direct/cod-mutation-plan.js'
import {createCodProofRepository} from '../../BelleLocal POS app/src/features/firebase-direct/cod-proof-repository.js'
import {MAIN_OWNER_UID} from '../../BelleLocal POS app/src/features/firebase-direct/content-model.js'
import {digest} from '../../BelleLocal POS app/src/shared/pos-domain/mutation.js'
const require=createRequire(new URL('../../BelleLocal POS app/package.json',import.meta.url)),sdk=require('firebase/firestore')
const{initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing')
if(process.env.DIRECT_FIRESTORE_EMULATOR!=='127.0.0.1:8088')throw Error('Use the isolated direct emulator.')
const env=await initializeTestEnvironment({projectId:'demo-belle-direct-cod-proof',firestore:{host:'127.0.0.1',port:8088,rules:await readFile(new URL('../../BelleLocal POS app/config/firebase/firestore.direct.rules',import.meta.url),'utf8')}})
test.after(()=>env.cleanup())
const root='onlineShopV2/belle-online',ref=(db,table,id)=>sdk.doc(db,`${root}/${table}/${id}`),owner=()=>env.authenticatedContext(MAIN_OWNER_UID).firestore(),auth={currentUser:{uid:MAIN_OWNER_UID}}
async function fixture(count=2,{reverse=false}={}){
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();let batch=sdk.writeBatch(db),size=0
    const save=async(table,id,value)=>{batch.set(ref(db,table,id),value);if(++size===400){await batch.commit();batch=sdk.writeBatch(db);size=0}}
    await save('direct_runtime','main',{stock_authority:'ledger-v2',pos_cod_enabled:true,backend_writers_stopped:true,original_writers_stopped:true})
    await save('direct_stock_meta','main',{version:1})
    const date='2026-07-24T00:00:00.000Z'
    for(let index=0;index<count;index++){
      const id=`invoice-${index}`
      await save('pos_orders',id,{id,total:100,subtotal:100,discount:0,items:[],saleType:'ONLINE',collectionArrangement:'COD',fulfillmentStatus:'completed',cancellationState:null,paymentStatus:reverse?'paid':'unpaid',codCollectAmount:reverse?0:100,createdAt:date})
      await save('pos_delivery_memberships',id,{orderId:id})
      if(reverse){
        await save('pos_payments',`payment-${index}`,{id:`payment-${index}`,orderId:id,amount:100,type:'payment',scope:'cod-receipt',createdAt:date})
        await save('pos_payment_heads',id,{orderId:id,paid:100,payable:100,version:1,lastPaymentId:`payment-${index}`})
        await save('pos_payment_baselines',id,{orderId:id,paid:0,payable:100,source_hash:'a'.repeat(64)})
        await save('pos_cod_settlement_allocations',`allocation-${index}`,{id:`allocation-${index}`,settlementId:'receipt',orderId:id,paymentId:`payment-${index}`,amount:100,correctionPaymentId:null})
      }
    }
    if(reverse)await save('pos_cod_settlements','receipt',{id:'receipt',amount:count*100,receivingMethod:'Cash',createdAt:date,reversedAt:null})
    if(size)await batch.commit()
  })
  const db=owner(),planner=createCodMutationPlanner({db,auth,sdk})
  const plan=reverse?await planner.reverse('receipt',{reason:'Wrong statement'},'cod-proof-reversal-001'):await planner.receive({receivingMethod:'Cash',statementNumber:'123456',transactionId:'654321',paymentDate:'2026-07-23',amount:count*100,allocations:Array.from({length:count},(_,index)=>({orderId:`invoice-${index}`,expectedBalance:100}))},'cod-proof-receive-001')
  return{db,plan,proof:createCodProofRepository({db,auth,sdk})}
}
test('500 invoices seal all 500 Rules-validated proof chunks without a payment, order update or source-fence change',async()=>{
  const{db,plan,proof}=await fixture(500),result=await proof.prepare(plan)
  assert.equal(result.index,500);assert.equal(result.total,50000)
  assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/pos_cod_proofs/${plan.digest}/chunks`))).size,500)
  assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/pos_payments`))).size,0)
  assert.equal((await sdk.getDoc(ref(db,'pos_orders','invoice-0'))).data().paymentStatus,'unpaid')
  assert.equal((await sdk.getDoc(ref(db,'direct_stock_meta','main'))).data().version,1)
  assert.deepEqual(await proof.prepare(plan),result)
  await assertFails(sdk.updateDoc(ref(db,'pos_cod_proofs',plan.digest),{expectedAmount:1}))
  const publicDb=env.unauthenticatedContext().firestore()
  await assertFails(sdk.getDoc(ref(publicDb,'pos_cod_proofs',plan.digest)))
  await assertFails(sdk.getDoc(sdk.doc(publicDb,`${root}/pos_cod_proofs/${plan.digest}/chunks/0`)))
})
test('odd selection resumes a lost committed proof response with exact progress and no financial effects',async()=>{
  const{db,plan}=await fixture(3);let lose=true
  const intercepted={...sdk,async runTransaction(...args){const result=await sdk.runTransaction(...args);if(lose&&result?.index===1){lose=false;throw Error('Proof response lost')}return result}}
  await assert.rejects(createCodProofRepository({db,auth,sdk:intercepted}).prepare(plan),/response lost/)
  const result=await createCodProofRepository({db,auth,sdk}).prepare(plan)
  assert.equal(result.index,3);assert.equal(result.total,300)
  assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/pos_cod_proofs/${plan.digest}/chunks`))).size,3)
  assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/pos_payments`))).size,0)
})
test('Rules reject altered amounts, stale financial heads/missing delivery and skipped proof chunks; source change/capability withdrawal reject preparation',async()=>{
  for(const attack of ['amount','duplicate','head','membership','revision','disabled']){
    const{db,plan,proof}=await fixture()
    if(attack==='amount'){plan.financialEntries[0].paidAfter=101;plan.digest=digest(plan)}
    else if(attack==='duplicate'){plan.financialEntries[1].orderId=plan.financialEntries[0].orderId;plan.digest=digest(plan)}
    else await env.withSecurityRulesDisabled(async context=>{
      const db=context.firestore()
      if(attack==='head'){await sdk.setDoc(ref(db,'pos_payment_heads','invoice-0'),{orderId:'invoice-0',paid:1,payable:100,version:1,lastPaymentId:'other'});await sdk.setDoc(ref(db,'pos_payment_baselines','invoice-0'),{orderId:'invoice-0'})}
      if(attack==='membership')await sdk.deleteDoc(ref(db,'pos_delivery_memberships','invoice-0'))
      if(attack==='revision')await sdk.updateDoc(ref(db,'direct_stock_meta','main'),{version:2})
      if(attack==='disabled')await sdk.updateDoc(ref(db,'direct_runtime','main'),{pos_cod_enabled:false})
    })
    await assert.rejects(proof.prepare(plan),error=>attack==='revision'?error.status===409:error.code==='permission-denied')
    assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/pos_payments`))).size,0)
  }
  const{db,plan}=await fixture(3)
  const proofs=createCodProofRepository({db,auth,sdk:{...sdk,async runTransaction(...args){const value=await sdk.runTransaction(...args);if(value?.index===1)throw Error('Stop after first chunk');return value}}})
  await assert.rejects(proofs.prepare(plan),/Stop after/)
  await assertFails(sdk.updateDoc(sdk.doc(db,`${root}/pos_cod_proofs/${plan.digest}/progress/main`),{index:2,total:300}))
})
test('reasoned reversal proof validates both immutable original receipts and existing heads without creating corrections',async()=>{
  const{db,plan,proof}=await fixture(2,{reverse:true}),result=await proof.prepare(plan)
  assert.equal(result.index,2);assert.equal(result.total,200)
  assert.equal(plan.financialEntries[0].paidAfter,0);assert.equal(plan.financialEntries[0].version,2)
  assert.equal((await sdk.getDocs(sdk.collection(db,`${root}/pos_payments`))).size,2)
  assert.equal((await sdk.getDoc(ref(db,'pos_payment_heads','invoice-0'))).data().paid,100)
})
