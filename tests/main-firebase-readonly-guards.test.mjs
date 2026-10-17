import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,realpathSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {basename,join,sep} from 'node:path'
import {fileURLToPath} from 'node:url'

test('Main source inspection refuses implicit execution, demo runtimes and missing credentials before loading the database SDK',()=>{
  const temporary=mkdtempSync(join(tmpdir(),'belle-readonly-guards-')),env={...process.env,GOOGLE_APPLICATION_CREDENTIALS:join(temporary,'missing-test-credential.json')},script=fileURLToPath(new URL('../scripts/main-firebase-readonly.mjs',import.meta.url))
  for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','GCLOUD_PROJECT'])delete env[key]
  try{
    const cases=[{args:[],env,reason:/Use --run-live/},{args:['--run-live'],env:{...env,FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'},reason:/demo\/emulator/},{args:['--run-live'],env,reason:/Credentials are unavailable/}]
    for(const scenario of cases){const result=spawnSync(process.execPath,[script,...scenario.args],{env:scenario.env,encoding:'utf8',timeout:5000,windowsHide:true});assert.equal(result.status,2,result.stderr);assert.match(result.stderr,/No database request made/);assert.match(result.stderr,scenario.reason);assert.equal(result.stdout,'')}
  }finally{const target=realpathSync(temporary),root=realpathSync(tmpdir());assert.ok(target.startsWith(root+sep)&&basename(target).startsWith('belle-readonly-guards-'),'Cleanup must remain in the freshly created test directory');rmSync(target,{recursive:true,force:true})}
})
