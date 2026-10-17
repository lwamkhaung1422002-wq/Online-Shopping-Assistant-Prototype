$ErrorActionPreference = 'Stop'
$taskWorkspace = Split-Path -Parent $PSScriptRoot
$taskBelle = Join-Path (Split-Path -Parent $taskWorkspace) 'BelleLocal POS app'
$taskJar = Join-Path $taskBelle '.firebase-emulators/cloud-firestore-emulator-v1.21.0.jar'
$taskUnixFallback = Join-Path $taskWorkspace 'test-results/disabled-unix-socket-directory'
if (!(Test-Path -LiteralPath $taskJar -PathType Leaf)) { throw 'The local Firestore emulator JAR is missing.' }
if (Test-Path -LiteralPath $taskUnixFallback) { throw 'The Unix socket fallback path must remain absent.' }
# This Windows JDK fails to connect Unix-domain selector sockets. An absent
# socket directory triggers its existing TCP-loopback fallback, without changing
# the installed JDK or connecting to a live Firebase project.
Push-Location -LiteralPath $taskBelle
try {
  & java "-Djdk.net.unixdomain.tmpdir=$taskUnixFallback" -jar $taskJar --host 127.0.0.1 --port 8080 --rules online-shop.emulator.rules --project_id demo-belle-online
  $taskExitCode = $LASTEXITCODE
} finally { Pop-Location }
exit $taskExitCode
