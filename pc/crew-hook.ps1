# Claude Code hook for Claude Crew. Records this session's status, then starts a background push.
# Installed by pc\install.ps1. Never blocks Claude: any error just exits 0.
$ErrorActionPreference = 'SilentlyContinue'
try {
  [Console]::InputEncoding = [Text.Encoding]::UTF8
  $dir = Join-Path $env:LOCALAPPDATA 'ClaudeCrew'
  $e = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if (-not $e.session_id) { exit 0 }

  function Clean([string]$t, [int]$n) {
    if (-not $t) { return '' }
    $t = ($t -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
    $t = $t -replace '(sk-ant|ghp_|gho_|github_pat_|xox[bp]-)\S*', '' -replace '[A-Za-z]:\\\S*', '' -replace '\S+@\S+\.\S+', ''
    $t = ($t -replace '[*_`#>\[\]]', '' -replace '\s+', ' ').Trim()
    if ($t.Length -gt $n) { $t = $t.Substring(0, $n - 1).TrimEnd() + [char]0x2026 }
    return $t
  }
  function LastReply([string]$path) {
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { return '' }
    $fs = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
    try {
      $len = [Math]::Min($fs.Length, 131072); [void]$fs.Seek(-$len, 'End')
      $buf = New-Object byte[] $len; [void]$fs.Read($buf, 0, $len)
    } finally { $fs.Close() }
    $lines = [Text.Encoding]::UTF8.GetString($buf) -split "`n"
    for ($i = $lines.Count - 1; $i -ge 0; $i--) {
      if ($lines[$i] -notmatch '"type"\s*:\s*"assistant"') { continue }
      try { $j = $lines[$i] | ConvertFrom-Json } catch { continue }
      foreach ($c in @($j.message.content)) { if ($c.type -eq 'text' -and $c.text.Trim()) { return Clean (($c.text -split '(?<=[.!?])\s')[0]) 140 } }
    }
    return ''
  }

  $now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  $stateFile = Join-Path $dir 'state.json'
  $mx = New-Object System.Threading.Mutex($false, 'Local\ClaudeCrewState')
  [void]$mx.WaitOne(4000)
  try {
    $state = @{}
    if (Test-Path -LiteralPath $stateFile) {
      $j = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($p in $j.PSObject.Properties) { $h = @{}; foreach ($q in $p.Value.PSObject.Properties) { $h[$q.Name] = $q.Value }; $state[$p.Name] = $h }
    }
    $id = 'pc_' + $e.session_id
    $s = $state[$id]
    if (-not $s) { $s = @{ title = ''; state = 'working'; started = $now; updated = $now; folder = ''; note = '' } }
    if ($e.cwd) { $s.folder = Clean (Split-Path -Leaf $e.cwd) 60 }
    switch ($e.hook_event_name) {
      'UserPromptSubmit' { $s.state = 'working'; $s.note = ''; if (-not $s.title) { $s.title = Clean $e.prompt 90 } }
      'Stop'             { $s.state = 'done'; $s.note = LastReply $e.transcript_path }
      'Notification'     { if ($e.message -match 'permission|approv|allow') { $s.state = 'needs_you'; $s.note = Clean $e.message 140 } else { exit 0 } }
      'SessionEnd'       { if ($s.state -ne 'needs_you') { $s.state = 'done' } }
      default            { }
    }
    $s.updated = $now
    $state[$id] = $s
    # keep the last 7 days, newest 40
    $cut = (Get-Date).ToUniversalTime().AddDays(-7)
    $keep = [ordered]@{}
    $state.GetEnumerator() | Where-Object { [datetime]::Parse($_.Value.updated).ToUniversalTime() -gt $cut } |
      Sort-Object { $_.Value.updated } -Descending | Select-Object -First 40 | ForEach-Object { $keep[$_.Key] = $_.Value }
    [IO.File]::WriteAllText($stateFile, ($keep | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
  } finally { $mx.ReleaseMutex() }

  Start-Process -WindowStyle Hidden -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $dir 'crew-push.ps1'))
} catch { }
exit 0
