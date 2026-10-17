$ErrorActionPreference = 'Stop'
$gcloudTaskRoot = Join-Path $env:LOCALAPPDATA 'BelleMainReadOnlyTools\gcloud-588.0.0'
$gcloudRunner = Join-Path $gcloudTaskRoot 'google-cloud-sdk\bin\gcloud.cmd'
$mainAdcPath = Join-Path $env:APPDATA 'gcloud\application_default_credentials.json'
if (Test-Path -LiteralPath $mainAdcPath -PathType Leaf) {
    throw 'An ADC credential already exists. Inspect the existing authorized connection before replacing it.'
}
if ($env:GOOGLE_APPLICATION_CREDENTIALS) {
    throw 'A credential path is already configured. Inspect that authorized connection before creating another one.'
}
if (!(Test-Path -LiteralPath $gcloudRunner -PathType Leaf)) {
    throw 'The verified local Google Cloud CLI is not ready yet.'
}
# This opens no billing/deployment workflow. The user reviews and completes the
# Google consent in their browser. The generated credential stays outside Git.
$env:CLOUDSDK_CORE_DISABLE_USAGE_REPORTING = 'true'
Write-Host 'Use lwamkhaung1422002@gmail.com and review Google Cloud SDK access before granting it.'
Write-Host 'ADC can use your existing Google Cloud permissions; the prepared API itself only reads the fixed Belle source.'
Write-Host 'Do not post passwords, authorization codes or credential files in chat.'
& $gcloudRunner auth application-default login 'lwamkhaung1422002@gmail.com' --no-launch-browser --disable-quota-project '--scopes=openid,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/cloud-platform'
exit $LASTEXITCODE
