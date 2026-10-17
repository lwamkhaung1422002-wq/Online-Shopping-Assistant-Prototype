import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { resolveDevCredential } from '../scripts/main-dev-credential.mjs'

test('dev launcher uses existing per-user credential when terminal APPDATA differs; explicit invalid credentials fail closed',()=>{
  const user='C:/Users/Owner', expected=join(user,'AppData','Roaming','gcloud','application_default_credentials.json')
  const stat=path=>{if(path!==expected)throw Error('missing');return {isFile:()=>true}}
  assert.equal(resolveDevCredential({APPDATA:'C:/temporary/roaming',USERPROFILE:user},stat),expected)
  assert.equal(resolveDevCredential({GOOGLE_APPLICATION_CREDENTIALS:expected},stat),expected)
  assert.throws(()=>resolveDevCredential({GOOGLE_APPLICATION_CREDENTIALS:'missing',USERPROFILE:user},stat),/Correct that variable/)
  assert.throws(()=>resolveDevCredential({APPDATA:'missing'},stat),/No database request/)
})
