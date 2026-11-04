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
    $t = $t -replace '(sk-ant|ghp_|gho_|github_pat_|xox[bp]-)\S*', '' -replace '[A-Za-z]:\\(?:\S*\\)?(\S*)', '$1' -replace '\S+@\S+\.\S+', ''
    $t = ($t -replace '[*_`#>\[\]]', '' -replace '\s+', ' ').Trim()
    if ($t.Length -gt $n) { $t = $t.Substring(0, $n - 1).TrimEnd() + [char]0x2026 }
    return $t
  }
  function FirstSentence([string]$t) { return ($t.Trim() -split '(?<=[.!?])\s')[0] }
  # A slice of the session's transcript. Title records repeat every turn, so the tail has the newest one; the head has the first prompt.
  function Slice([string]$path, [string]$from) {
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { return '' }
    $fs = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
    try {
      $len = [Math]::Min($fs.Length, 262144); if ($from -eq 'End') { [void]$fs.Seek(-$len, 'End') }
      $buf = New-Object byte[] $len; [void]$fs.Read($buf, 0, $len)
    } finally { $fs.Close() }
    return [Text.Encoding]::UTF8.GetString($buf)
  }
  # The name Claude gave the session: one set by hand or the desktop app first, else the automatic one.
  function TranscriptTitle([string]$txt) {
    foreach ($pat in '"type":"custom-title","customTitle":"((?:[^"\\]|\\.)*)"', '"type":"ai-title","aiTitle":"((?:[^"\\]|\\.)*)"') {
      $m = [regex]::Match($txt, $pat, 'RightToLeft')
      if (-not $m.Success) { continue }
      $t = Clean ('"' + $m.Groups[1].Value + '"' | ConvertFrom-Json) 90
      if ($t -and $t -notmatch '^[a-z]+(-[a-z0-9]+)+$') { return $t } # skip machine names like "brave-otter-12"
    }
    return ''
  }
  # What the person actually asked, without the wrappers remote and scheduled messages arrive in. '' if there is none.
  function HumanText([string]$p) {
    if (-not $p) { return '' }
    if ($p -match '<scheduled-task\s+name="([^"]+)"') { return 'Scheduled task: ' + ($matches[1] -replace '[-_]', ' ') }
    $m = [regex]::Matches($p, '(?s)<message\b[^>]*>(.*?)(</message>|$)')
    if ($m.Count) { $p = $m[$m.Count - 1].Groups[1].Value }
    else { $n = [regex]::Match($p, '(?s)<note>(.*?)(</note>|$)'); if ($n.Success) { $p = $n.Groups[1].Value } }
    $p = [regex]::Replace($p, '(?s)<(pasted_content|system-reminder|task-notification|side-sessions-event|ci-monitor-event)\b.*?(</\1>|$)', ' ')
    return [Net.WebUtility]::HtmlDecode(($p -replace '<[^>]+>', ' ')).Trim()
  }
  # A real prompt from the transcript, for when the hook wasn't handed one: the first in the text, or with -Newest the last.
  function FindHuman([string]$txt, [switch]$Newest) {
    $lines = $txt -split "`n"
    if ($Newest) { [array]::Reverse($lines) }
    foreach ($line in $lines) {
      if ($line -notmatch '^\{.*"type"\s*:\s*"user"') { continue }
      try { $j = $line | ConvertFrom-Json } catch { continue }
      $c = $j.message.content
      $raw = if ($c -is [string]) { $c } else { (@($c) | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }) -join ' ' }
      $h = HumanText $raw
      if ($h) { return $h }
    }
    return ''
  }
  # Claude's last reply: its first sentence becomes the note; a reply that ends on a question means it is waiting on you, and the question is the note.
  # A usage-limit stop ("5-hour limit reached - resets 3pm", "Claude AI usage limit reached|1730000000") is a pause, not a finish.
  function LimitNote([string]$t) {
    if ($t.Length -gt 400 -or $t -notmatch '(?i)(usage|session|weekly|hour|opus|sonnet)\s*limit|limit (reached|hit|exceeded)|out of (extra )?usage') { return '' }
    $when = ''
    if ($t -match '\|(\d{10})\b') { $when = ([DateTimeOffset]::FromUnixTimeSeconds([int64]$Matches[1])).LocalDateTime.ToString('h:mm tt') }
    elseif ($t -match '(?i)resets?\s+(at\s+)?([^.\n|]{2,30})') { $when = $Matches[2].Trim() }
    return 'Paused: usage limit reached' + $(if ($when) { ", resets $when" } else { '' })
  }
  function LastReply([string]$txt) {
    $r = @{ note = ''; asks = $false; limit = '' }
    $lines = $txt -split "`n"
    for ($i = $lines.Count - 1; $i -ge 0; $i--) {
      if ($lines[$i] -notmatch '"type"\s*:\s*"assistant"') { continue }
      try { $j = $lines[$i] | ConvertFrom-Json } catch { continue }
      foreach ($c in @($j.message.content)) {
        if ($c.type -eq 'text' -and $c.text.Trim()) {
          $r.limit = LimitNote $c.text.Trim()
          $last = ($c.text.Trim() -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 1)
          $r.asks = $last -match '\?\s*[*_`)]*\s*$'
          $r.note = Clean $(if ($r.asks) { $last } else { FirstSentence $c.text }) 140
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
    $tail = Slice $e.transcript_path 'End'
    # Scheduled tasks (they start with a <scheduled-task> wrapper) are routine runs, so the phone never shows them.
    if ($null -eq $s.scheduled) { $s.scheduled = [bool](("$($e.prompt)" -match '<scheduled-task') -or ((Slice $e.transcript_path 'Begin') -match '<scheduled-task')) }
    elseif (-not $s.scheduled -and "$($e.prompt)" -match '^\s*<scheduled-task') { $s.scheduled = $true }
    # A finished reply that hands you a step ("press Ctrl+S", "you should decide", "the push failed") is waiting on you.
    $needRx = '(?i)\b(you (should|need to|must|will need to|have to|can now)|your (call|decision|turn|ok|approval|go-ahead)|decide|press |click |tap |reply |type |sign in|log in|waiting (for|on) you|needs? (you|your)|still (public|broken|failing|private)|failed|conflict)'
    $asked = if ($e.prompt) { HumanText $e.prompt } else { '' }
    switch ($e.hook_event_name) {
      'UserPromptSubmit' { $s.state = 'working'; if ($asked.Length -ge 12) { $s.note = Clean ('Asked: ' + $asked) 140 } } # a bare "yes" says nothing, so the last note stays
      'Stop'             {
        $lr = LastReply $tail; $s.note = $lr.note
        if ($lr.limit) { $s.state = 'paused'; $s.note = $lr.limit }
        else { $s.state = $(if ($lr.asks -or $lr.note -match $needRx) { 'needs_you' } else { 'done' }); $s.retitle = $true }
      }
      'Notification'     { if ($e.message -match 'permission|approv|allow') { $s.state = 'needs_you'; $s.note = Clean $e.message 140 } else { exit 0 } }
      'SessionEnd'       { if ($s.state -ne 'needs_you') { $s.state = 'done' } }
      'Retitle'          { if ($s.state -eq 'working' -and -not $s.note) { $s.note = Clean (FindHuman $tail -Newest) 140 } }
      default            { }
    }
    # Name it from Claude's own title for the session, which can appear or change at any turn; failing that, from the first thing asked.
    $named = TranscriptTitle $tail
    if ($named -and -not $s.aiTitle) { $s.title = $named } # once the title writer has named it, keep that name so it doesn't flip back and forth
    elseif (-not $s.title -or $s.title -match '^<|^Claude in ') {
      $first = FindHuman (Slice $e.transcript_path 'Begin')
      if (-not $first) { $first = $asked }
      $s.title = Clean (FirstSentence $first) 90
    }
    # "Retitle" only repairs names (see pc\retitle.ps1), so a session nobody touched doesn't jump to the top.
    if ($e.hook_event_name -ne 'Retitle') { $s.updated = $now }
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
