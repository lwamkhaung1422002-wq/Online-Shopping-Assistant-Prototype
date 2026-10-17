import test from 'node:test'
import assert from 'node:assert/strict'
import {frontendRunning} from '../scripts/main-dev-browser.mjs'

test('dev reuses only the matching frontend, rejects another service and starts when no listener exists',async()=>{
  const url='http://127.0.0.1:5178/'
  assert.equal(await frontendRunning(url,'pos',async()=>new Response(null,{headers:{'X-Belle-Frontend':'pos'}})),true)
  await assert.rejects(frontendRunning(url,'pos',async()=>new Response(null,{headers:{'X-Belle-Frontend':'dashboard'}})),/different service/)
  assert.equal(await frontendRunning(url,'pos',async()=>{throw Error('connection refused')}),false)
})
