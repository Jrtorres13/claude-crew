# Installs Claude Crew live sync on this PC: copies the hook, saves the feed key, and adds the hook to Claude Code.
#   powershell -ExecutionPolicy Bypass -File install.ps1
# It asks for the feed key (the same key the phone uses). A backup of settings.json is saved first.
param([string]$Key = '')
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dir = Join-Path $env:LOCALAPPDATA 'ClaudeCrew'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

if (-not $Key) { $Key = Read-Host 'Paste your Claude Crew feed key' }
$Key = $Key.Trim()
if ($Key.Length -lt 12) { Write-Host 'That key looks too short. Nothing was installed.' -ForegroundColor Red; exit 1 }
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { Write-Host 'GitHub CLI (gh) was not found. Install it and sign in first. Nothing was installed.' -ForegroundColor Red; exit 1 }

Copy-Item -Force -LiteralPath (Join-Path $src 'crew-hook.ps1'), (Join-Path $src 'crew-push.ps1') -Destination $dir
[IO.File]::WriteAllText((Join-Path $dir 'config.json'), ([ordered]@{ key = $Key; gh = $gh; repo = 'Jrtorres13/claude-crew' } | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
if (-not (Test-Path (Join-Path $dir 'state.json'))) { [IO.File]::WriteAllText((Join-Path $dir 'state.json'), '{}') }

# Add the hook to Claude Code's user settings, once per event, keeping everything already there.
$claude = Join-Path $env:USERPROFILE '.claude'
New-Item -ItemType Directory -Force -Path $claude | Out-Null
$settingsPath = Join-Path $claude 'settings.json'
$settings = if (Test-Path $settingsPath) { Copy-Item $settingsPath "$settingsPath.crew-backup" -Force; Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{} }
if (-not $settings.PSObject.Properties['hooks']) { $settings | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) }
$cmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $dir 'crew-hook.ps1') + '"'
foreach ($ev in 'UserPromptSubmit', 'Stop', 'Notification', 'SessionEnd') {
  $list = @()
  if ($settings.hooks.PSObject.Properties[$ev]) { $list = @($settings.hooks.$ev) }
  $list = @($list | Where-Object { -not (($_.hooks | ForEach-Object { $_.command }) -match 'crew-hook\.ps1') })
  $list += [pscustomobject]@{ hooks = @([pscustomobject]@{ type = 'command'; command = $cmd; timeout = 10 }) }
  if ($settings.hooks.PSObject.Properties[$ev]) { $settings.hooks.$ev = $list } else { $settings.hooks | Add-Member -NotePropertyName $ev -NotePropertyValue $list }
}
[IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 32), (New-Object Text.UTF8Encoding($false)))
Write-Host 'Claude Crew live sync is on. New Claude Code sessions report to your phone as they go.' -ForegroundColor Green
Write-Host 'Already-open Claude Code windows pick it up after a restart.'
