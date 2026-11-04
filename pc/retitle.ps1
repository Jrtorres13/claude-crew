# Renames the sessions already in Claude Crew using the installed hook, without changing their status or time.
#   powershell -ExecutionPolicy Bypass -File retitle.ps1
$dir = Join-Path $env:LOCALAPPDATA 'ClaudeCrew'
$j = Get-Content -LiteralPath (Join-Path $dir 'state.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$projects = Join-Path $env:USERPROFILE '.claude\projects'
foreach ($p in $j.PSObject.Properties) {
  $sid = $p.Name -replace '^pc_', ''
  $f = Get-ChildItem -LiteralPath $projects -Directory | ForEach-Object { Join-Path $_.FullName "$sid.jsonl" } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $f) { continue }
  @{ session_id = $sid; hook_event_name = 'Retitle'; transcript_path = $f } | ConvertTo-Json -Compress |
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'crew-hook.ps1')
}
