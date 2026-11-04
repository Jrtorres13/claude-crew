# Pushes the encrypted live feed for Claude Crew to GitHub (branch "live" of Jrtorres13/claude-crew).
# Started in the background by crew-hook.ps1. Only one runs at a time; it re-pushes if more changes landed.
#   powershell -File crew-push.ps1 -Test   pushes once and prints what happened
param([switch]$Test)
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'ClaudeCrew'
$log = Join-Path $dir 'push.log'
function Log($m) { Add-Content -LiteralPath $log -Value ((Get-Date).ToString('s') + ' ' + $m); if ($Test) { Write-Host $m } }

$cfg = Get-Content -LiteralPath (Join-Path $dir 'config.json') -Raw | ConvertFrom-Json
$stateFile = Join-Path $dir 'state.json'

function Encrypt([string]$plain, [string]$pass) {
  # PBKDF2-SHA256 -> 32-byte AES-CBC key + 32-byte HMAC-SHA256 key (encrypt-then-MAC). The app checks the MAC first.
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $salt = New-Object byte[] 16; $iv = New-Object byte[] 16; $rng.GetBytes($salt); $rng.GetBytes($iv)
  $kdf = New-Object Security.Cryptography.Rfc2898DeriveBytes($pass, $salt, 150000, [Security.Cryptography.HashAlgorithmName]::SHA256)
  $keys = $kdf.GetBytes(64)
  $aes = [Security.Cryptography.Aes]::Create(); $aes.Mode = 'CBC'; $aes.Padding = 'PKCS7'
  $aes.Key = [byte[]]$keys[0..31]; $aes.IV = $iv
  $pt = [Text.Encoding]::UTF8.GetBytes($plain)
  $ct = $aes.CreateEncryptor().TransformFinalBlock($pt, 0, $pt.Length)
  $hm = New-Object Security.Cryptography.HMACSHA256 -ArgumentList (, [byte[]]$keys[32..63])
  $mac = $hm.ComputeHash([byte[]]($iv + $ct))
  $b = { param($x) [Convert]::ToBase64String([byte[]]$x) }
  return [ordered]@{ v = 2; updated = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); iter = 150000; salt = (& $b $salt); iv = (& $b $iv); data = (& $b $ct); mac = (& $b $mac) }
}

function PushOnce {
  $mx = New-Object System.Threading.Mutex($false, 'Local\ClaudeCrewState'); [void]$mx.WaitOne(4000)
  try { $j = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json } finally { $mx.ReleaseMutex() }
  $items = @()
  foreach ($p in $j.PSObject.Properties) {
    $s = $p.Value
    $title = if ($s.title) { $s.title } else { 'Claude in ' + $(if ($s.folder) { $s.folder } else { 'a folder' }) }
    $it = [ordered]@{ id = $p.Name; title = $title; state = $s.state; source = 'pc'; project = $s.folder; started = $s.started; updated = $s.updated }
    if ($s.note) { $it.note = $s.note }
    $items += $it
  }
  $plain = [ordered]@{ generated_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); live = $true; items = $items } | ConvertTo-Json -Depth 5 -Compress
  $box = Encrypt $plain $cfg.key | ConvertTo-Json -Compress
  $api = "repos/$($cfg.repo)/contents/crew-live.json"
  $sha = ''
  try { $sha = (& $cfg.gh api "$($api)?ref=live" --jq .sha 2>$null) } catch { }
  $body = [ordered]@{ message = 'Claude Crew live'; branch = 'live'; content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($box)) }
  if ($sha) { $body.sha = "$sha".Trim() }
  $tmp = Join-Path $dir 'body.json'
  [IO.File]::WriteAllText($tmp, ($body | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
  $out = & $cfg.gh api -X PUT $api --input $tmp 2>&1
  if ($LASTEXITCODE -ne 0) { throw "gh api failed: $out" }
  Log "pushed $($items.Count) sessions"
}

$pm = New-Object System.Threading.Mutex($false, 'Local\ClaudeCrewPush')
if (-not $pm.WaitOne(0)) { exit 0 }
try {
  if (-not $Test) { Start-Sleep -Seconds 3 }
  for ($i = 0; $i -lt 4; $i++) {
    $stamp = (Get-Item -LiteralPath $stateFile).LastWriteTimeUtc
    try { PushOnce } catch { Log "error: $($_.Exception.Message)"; Start-Sleep -Seconds 5 }
    if ($Test) { break }
    Start-Sleep -Seconds 2
    if ((Get-Item -LiteralPath $stateFile).LastWriteTimeUtc -eq $stamp) { break }
  }
} finally { $pm.ReleaseMutex() }
# keep the log small
if ((Test-Path $log) -and (Get-Item $log).Length -gt 200KB) { Get-Content $log -Tail 300 | Set-Content $log }
