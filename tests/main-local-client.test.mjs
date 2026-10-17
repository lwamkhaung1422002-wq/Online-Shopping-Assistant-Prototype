import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePosRuntime } from '../../BelleLocal POS app/src/features/shop-admin/editor/services/pos-runtime.js'
import { validateDashboardRuntime } from '../dashboard/shared/runtime.js'

test('POS Main business mode is explicitly local, exact-project and separate from source-only and demo modes',()=>{
  const main={dev:true,mainLocal:'true',projectId:'pos-shop-owner',apiUrl:'http://127.0.0.1:5003'}
  assert.deepEqual(validatePosRuntime(main),{readOnly:false,mainLocal:true})
  for(const change of [{dev:false},{projectId:'demo-belle-online'},{apiUrl:'http://127.0.0.1:5002'},{apiUrl:'http://localhost:5003'},{apiUrl:'http://127.0.0.1:5003/?key=1'},{apiUrl:'http://user:pass@127.0.0.1:5003'},{apiUrl:''},{mainReadOnly:'true'}])assert.throws(()=>validatePosRuntime({...main,...change}))
  assert.throws(()=>validatePosRuntime({...main,mainLocal:undefined}))
})

test('public Main dashboard never attaches an emulator or silently falls back to real credentials',()=>{
  const env={DEV:true,VITE_MAIN_LOCAL:'true'}
  assert.deepEqual(validateDashboardRuntime(env,'http://127.0.0.1:5003','pos-shop-owner','belle-online'),{mainLocal:true,useEmulator:false})
  for(const values of [[{...env,DEV:false},'http://127.0.0.1:5003','pos-shop-owner','belle-online'],[env,'http://127.0.0.1:5003','demo-belle-online','belle-online'],[env,'http://127.0.0.1:5003','pos-shop-owner','other'],[env,'http://localhost:5003','pos-shop-owner','belle-online'],[env,'http://127.0.0.1:5003/path','pos-shop-owner','belle-online'],[{},'http://127.0.0.1:5003','pos-shop-owner','belle-online']])assert.throws(()=>validateDashboardRuntime(...values))
  assert.deepEqual(validateDashboardRuntime({},'http://127.0.0.1:5001','demo-belle-online','belle-online'),{mainLocal:false,useEmulator:true})
})
