# One-step setup for the Claude Crew hub (phone alerts + sync). Run in PowerShell:
#   powershell -ExecutionPolicy Bypass -File deploy.ps1
# Creates the storage, deploys the Worker on the ecomjayt Cloudflare account, points the PC scripts at it,
# and saves the storage id to GitHub. Safe to run again: it reuses what already exists.
# Windows PowerShell treats npm's harmless notices on stderr as errors, so npx runs through cmd, which merges them.
$ErrorActionPreference = 'Continue'
function Npx([string]$a) { return (cmd /c "npx --yes $a 2>&1" | Out-String) }
$hub = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $hub
Set-Location $hub

Write-Host 'Finding your ecomjayt Cloudflare account...'
$who = (Npx 'wrangler whoami')
$acct = [regex]::Matches($who, '(?im)^.*ecomjayt.*?([0-9a-f]{32})') | Select-Object -First 1
if (-not $acct) { Write-Host 'Could not find an ecomjayt account in "wrangler whoami". Run: npx wrangler login   then run this again.' -ForegroundColor Red; exit 1 }
$env:CLOUDFLARE_ACCOUNT_ID = $acct.Groups[1].Value
Write-Host "Using account $($env:CLOUDFLARE_ACCOUNT_ID)"

$cfgText = Get-Content wrangler.jsonc -Raw
if ($cfgText -match 'PASTE_KV_ID') {
  Write-Host 'Creating storage...'
  $out = (Npx 'wrangler kv namespace create CREW')
  $id = [regex]::Match($out, '[0-9a-f]{32}').Value
  if (-not $id) {
    $list = try { (cmd /c "npx --yes wrangler kv namespace list 2>nul" | Out-String) | ConvertFrom-Json } catch { @() }
    $id = ($list | Where-Object { $_.title -match 'CREW' } | Select-Object -First 1).id
  }
  if (-not $id) { Write-Host "Could not create the storage:`n$out" -ForegroundColor Red; exit 1 }
  $cfgText = $cfgText -replace 'PASTE_KV_ID', $id
  $cfgText = $cfgText -replace '"main": "src/index.js",', ('"main": "src/index.js",' + "`n  `"account_id`": `"$($env:CLOUDFLARE_ACCOUNT_ID)`",")
  [IO.File]::WriteAllText((Join-Path $hub 'wrangler.jsonc'), $cfgText, (New-Object Text.UTF8Encoding($false)))
}

Write-Host 'Deploying...'
$dep = (Npx 'wrangler deploy')
$url = [regex]::Match($dep, 'https://[a-z0-9.-]+\.workers\.dev').Value
if (-not $url) { Write-Host "Deploy failed:`n$dep" -ForegroundColor Red; exit 1 }
Write-Host "Hub is live at $url"
$v = Invoke-RestMethod "$url/vapid"
if (-not $v.key) { Write-Host 'The hub answered without a key. Something is wrong.' -ForegroundColor Red; exit 1 }

Write-Host 'Pointing your PC scripts at it...'
$key = (Get-Content (Join-Path $env:LOCALAPPDATA 'ClaudeCrew\config.json') -Raw | ConvertFrom-Json).key
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'pc\install.ps1') -Key $key -Hub $url
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $env:LOCALAPPDATA 'ClaudeCrew\crew-push.ps1') -Test

Write-Host 'Saving the storage id to GitHub...'
Set-Location $repo
git add hub/wrangler.jsonc
cmd /c "git commit -m ""Hub: storage id and account for the deployed Worker"" 2>&1" | Out-Null
cmd /c "git pull --rebase origin main 2>&1"
cmd /c "git push origin main 2>&1"
Write-Host ''
Write-Host 'Done. On your phone: Update now, then Settings, Phone alerts, Turn on.' -ForegroundColor Green
