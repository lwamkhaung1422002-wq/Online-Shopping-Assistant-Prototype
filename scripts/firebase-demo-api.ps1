$ErrorActionPreference = 'Stop'
$taskWorkspace = Split-Path -Parent $PSScriptRoot
$taskBelle = Join-Path (Split-Path -Parent $taskWorkspace) 'BelleLocal POS app'
$taskLocalEnvironment = Join-Path $taskBelle 'functions/.env.local'
if (!(Test-Path -LiteralPath $taskLocalEnvironment -PathType Leaf)) { throw 'The isolated demo Functions environment is missing.' }
if (!(Get-Content -LiteralPath $taskLocalEnvironment | Where-Object { $_ -ceq 'ONLINE_SHOP_OWNER_UID=demo-owner' })) { throw 'This launcher requires the fictional demo owner.' }
# Firestore runs separately using firestore-demo.ps1. Explicit discovery timeout
# accommodates the complete source module graph; it changes no production flags.
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
# This guarded launcher runs on the user's PC, never on a Google VM. Avoid
# the SDK's unavailable 169.254.169.254 metadata probe during CLI discovery.
$env:METADATA_SERVER_DETECTION = 'none'
$env:FUNCTIONS_DISCOVERY_TIMEOUT = '120'
$env:CI = 'true'
Push-Location -LiteralPath $taskBelle
try {
  & node node_modules/firebase-tools/lib/bin/firebase.js emulators:start --only auth,functions,storage --project demo-belle-online --config firebase.online-shop.emulator.json
  $taskExitCode = $LASTEXITCODE
} finally { Pop-Location }
exit $taskExitCode
