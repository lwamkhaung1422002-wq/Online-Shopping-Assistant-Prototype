import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(new URL('../../BelleLocal POS app/package.json',import.meta.url)),sdk=require('firebase/firestore')
const{initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing')
if(process.env.DIRECT_FIRESTORE_EMULATOR!=='127.0.0.1:8088')throw Error('Use the isolated direct emulator.')
// Diagnostic Rules for a disposable non-business namespace. These are never
// installed in Belle: real settlement eligibility/price/replay Rules remain
// necessary. The check isolates SDK transaction capacity and cached rule access.
const rules=`rules_version = '2'; service cloud.firestore {
  match /databases/{database}/documents {
    function owner() { return request.auth != null && request.auth.uid == 'capacity-owner'; }
    match /capacity/meta {
      allow read: if owner();
      allow update: if owner() && request.resource.data.version == resource.data.version + 1;
    }
    match /rows/{key} {
      allow read: if owner();
      allow create: if owner() && request.resource.data.keys().hasOnly(['index','payload'])
        && request.resource.data.index is int && request.resource.data.index >= 0
        && getAfter(/databases/$(database)/documents/capacity/meta).data.version == 1;
    }
  }
}`
const env=await initializeTestEnvironment({projectId:'demo-belle-direct-cod-capacity',firestore:{host:'127.0.0.1',port:8088,rules}})
test.after(()=>env.cleanup())
test('installed browser SDK atomically commits 2003 rows plus one shared cached Rules fence in the isolated emulator',async()=>{
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(context=>sdk.setDoc(sdk.doc(context.firestore(),'capacity/meta'),{version:0}))
  const db=env.authenticatedContext('capacity-owner').firestore(),meta=sdk.doc(db,'capacity/meta')
  await sdk.runTransaction(db,async tx=>{
    assert.equal((await tx.get(meta)).data().version,0)
    for(let index=0;index<2003;index++)tx.set(sdk.doc(db,`rows/row-${index}`),{index,payload:'capacity-only'.repeat(30)})
    tx.set(meta,{version:1})
  })
  assert.equal((await sdk.getDoc(meta)).data().version,1)
  assert.equal((await sdk.getDocs(sdk.collection(db,'rows'))).size,2003)
  await assertFails(sdk.getDocs(sdk.collection(env.unauthenticatedContext().firestore(),'rows')))
})
