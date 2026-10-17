import test from 'node:test'
import assert from 'node:assert/strict'
import { runDevServices } from '../scripts/main-local-dev.mjs'

test('npm dev starts its frontend immediately and retains it when API credentials/startup fail',async()=>{
  const events=[],server={running:true}
  const result=await runDevServices(()=>{events.push('frontend');return server},async()=>{events.push('api');throw Error('Credentials unavailable')},error=>events.push(error.message))
  assert.equal(result,server);assert.equal(server.running,true)
  assert.deepEqual(events,['frontend','api','Credentials unavailable'])
})
