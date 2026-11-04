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

# After a turn ends, ask Claude (Haiku, a few seconds, runs in the background) for a short title and a
# one-line "what's happening" from the transcript, so the phone shows the real work, not the first prompt.
# At most once every 20 minutes per session. Turn it off with "aiTitles": false in config.json.
function Retitle {
  if ($cfg.PSObject.Properties['aiTitles'] -and -not $cfg.aiTitles) { return 0 }
  $claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
  if (-not $claude) { return 0 }
  $done = 0
  $mx = New-Object System.Threading.Mutex($false, 'Local\ClaudeCrewState'); [void]$mx.WaitOne(4000)
  try { $j = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json } finally { $mx.ReleaseMutex() }
  $cut = (Get-Date).ToUniversalTime().AddMinutes(-20)
  foreach ($p in $j.PSObject.Properties) {
    $s = $p.Value
    if (-not $s.retitle -or -not $s.transcript -or -not (Test-Path -LiteralPath $s.transcript)) { continue }
    if ($s.titledAt -and [datetime]::Parse($s.titledAt).ToUniversalTime() -gt $cut) { continue }
    # the last ~40 user/assistant text messages, newest last, capped at 6000 characters
    $lines = Get-Content -LiteralPath $s.transcript -Tail 400 -Encoding UTF8
    $talk = New-Object System.Collections.Generic.List[string]
    foreach ($l in $lines) {
      if ($l -notmatch '"type"\s*:\s*"(user|assistant)"') { continue }
      try { $m = $l | ConvertFrom-Json } catch { continue }
      $who = $m.type; $c = $m.message.content
      $txt = if ($c -is [string]) { $c } else { (@($c) | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }) -join ' ' }
      $txt = ($txt -replace '(?s)<(pasted_content|system-reminder)[^>]*>.*?</\1>', ' ' -replace '<[^>]+>', ' ' -replace '\s+', ' ').Trim()
      if ($txt.Length -gt 3) { $talk.Add("$($who): " + $txt.Substring(0, [Math]::Min(600, $txt.Length))) }
    }
    if (-not $talk.Count) { continue }
    $ctx = ($talk | Select-Object -Last 40) -join "`n"
    if ($ctx.Length -gt 6000) { $ctx = $ctx.Substring($ctx.Length - 6000) }
    $ask = "Here is the end of a Claude Code session. Reply with ONLY one JSON object, no other text: " +
      '{"title": "what this session is working on, 3 to 7 words, starts with a verb, plain words", "now": "one short sentence: what just happened or what the person needs to do next"}' +
      " No file paths, keys, emails or IDs.`n`n" + $ctx
    $env:CLAUDE_CREW_INNER = '1'
    $out = ''
    try { $out = ($ask | & $claude -p --model haiku 2>$null) -join "`n" } catch { }
    $env:CLAUDE_CREW_INNER = ''
    if ($out -notmatch '(?s)\{.*\}') { continue }
    try { $r = $Matches[0] | ConvertFrom-Json } catch { continue }
    $clean = { param($t, $n) $t = ("$t" -replace '[A-Za-z]:\\\S*', '' -replace '\S+@\S+\.\S+', '' -replace '[*_`#<>]', '' -replace '\s+', ' ').Trim(); if ($t.Length -gt $n) { $t = $t.Substring(0, $n - 1) + [char]0x2026 }; $t }
    $mx.WaitOne(4000) | Out-Null
    try {
      $now = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      $t = $now.PSObject.Properties[$p.Name]
      if ($t) {
        $v = $t.Value
        foreach ($k in 'titledAt', 'retitle') { if (-not $v.PSObject.Properties[$k]) { $v | Add-Member -NotePropertyName $k -NotePropertyValue $null } }
        if ($r.title) { $v.title = & $clean $r.title 80 }
        if ($r.now -and $v.state -ne 'working') { $v.note = & $clean $r.now 140 }
        $v.titledAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); $v.retitle = $false
        [IO.File]::WriteAllText($stateFile, ($now | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
        Log "retitled $($p.Name)"; $done++
      }
    } finally { $mx.ReleaseMutex() }
  }
  return $done
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
  try { if ((Retitle) -gt 0) { PushOnce } } catch { Log "retitle error: $($_.Exception.Message)" }
} finally { $pm.ReleaseMutex() }
# keep the log small
if ((Test-Path $log) -and (Get-Item $log).Length -gt 200KB) { Get-Content $log -Tail 300 | Set-Content $log }
