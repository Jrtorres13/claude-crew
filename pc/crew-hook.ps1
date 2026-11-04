# Claude Code hook for Claude Crew. Records this session's status, then starts a background push.
# Installed by pc\install.ps1. Never blocks Claude: any error just exits 0.
$ErrorActionPreference = 'SilentlyContinue'
if ($env:CLAUDE_CREW_INNER -eq '1') { exit 0 }   # the title-writer's own Claude call: don't track it
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
  # Claude's last reply: its first sentence becomes the note; a reply that ends on a question means it is waiting on you.
  # What the person actually asked, without the wrappers apps put around prompts
  # (<relay>, <pasted_content>, <scheduled-task>, <system-reminder>, ...).
  function PromptText([string]$p) {
    if (-not $p) { return '' }
    if ($p -match '<scheduled-task[^>]*name="([^"]+)"') { return 'Scheduled task: ' + ($Matches[1] -replace '[-_]', ' ') }
    $body = $p
    if ($p -match '(?s)<note>(.*?)</note>') { $body = $Matches[1] }
    elseif ($p -match '(?s)<cited[^>]*>(.*?)</cited>') { $body = $Matches[1] }
    $own = ($body -replace '(?s)<(pasted_content|system-reminder|session-context|attachment)[^>]*>.*?</\1>', ' ')
    if (-not (($own -replace '<[^>]+>', '').Trim())) { $own = $body }
    $t = ($own -replace '<[^>]+>', ' ').Trim()
    $first = ($t -split "`r?`n" | Where-Object { $_.Trim().Length -gt 3 } | Select-Object -First 1)
    return Clean (($first -split '(?<=[.!?])\s')[0]) 90
  }
  function LastReply([string]$path) {
    $r = @{ note = ''; asks = $false }
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { return $r }
    $fs = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
    try {
      $len = [Math]::Min($fs.Length, 131072); [void]$fs.Seek(-$len, 'End')
      $buf = New-Object byte[] $len; [void]$fs.Read($buf, 0, $len)
    } finally { $fs.Close() }
    $lines = [Text.Encoding]::UTF8.GetString($buf) -split "`n"
    for ($i = $lines.Count - 1; $i -ge 0; $i--) {
      if ($lines[$i] -notmatch '"type"\s*:\s*"assistant"') { continue }
      try { $j = $lines[$i] | ConvertFrom-Json } catch { continue }
      foreach ($c in @($j.message.content)) {
        if ($c.type -eq 'text' -and $c.text.Trim()) {
          $r.note = Clean (($c.text -split '(?<=[.!?])\s')[0]) 140
          $last = ($c.text.Trim() -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 1)
          $r.asks = $last -match '\?\s*[*_`)]*\s*$'
          return $r
        }
      }
    }
    return $r
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
    if ($e.transcript_path) { $s.transcript = $e.transcript_path }
    if ($e.cwd) { $s.folder = Clean (Split-Path -Leaf $e.cwd) 60 }
    switch ($e.hook_event_name) {
      'UserPromptSubmit' { $s.state = 'working'; $ask = PromptText $e.prompt; if ($ask) { $s.note = 'Asked: ' + $ask }; if ($ask -and (-not $s.title -or $s.title -match '^<|^Claude in ')) { $s.title = $ask } }
      'Stop'             { $lr = LastReply $e.transcript_path; $s.note = $lr.note; $s.state = $(if ($lr.asks) { 'needs_you' } else { 'done' }); $s.retitle = $true }
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
