import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// Verification-only Firebase service, never an application API or Main DB.
const pos = fileURLToPath(new URL('../../BelleLocal POS app/', import.meta.url))
const absentUnixDirectory = join(pos, '.local/direct-emulator-no-unix/missing')
if (existsSync(absentUnixDirectory)) throw Error('The TCP fallback requires the configured Unix-socket directory to be absent.')
const child = spawn(process.execPath, ['node_modules/firebase-tools/lib/bin/firebase.js', 'emulators:start',
  '--config', 'firebase.direct.emulator.json', '--only', 'firestore', '--project', 'demo-belle-direct'], {
  cwd: pos, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, FIREBASE_EMULATORS_PATH: join(pos, '.firebase-emulators'), XDG_CONFIG_HOME: join(pos, '.firebase-config'), CI: 'true',
    ...(process.platform === 'win32' ? { JAVA_TOOL_OPTIONS: `${process.env.JAVA_TOOL_OPTIONS || ''} -Djdk.net.unixdomain.tmpdir="${absentUnixDirectory}" -Dio.netty.eventLoopThreads=2 -Djava.net.preferIPv4Stack=true`.trim() } : {}) },
})
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code || 0 })
