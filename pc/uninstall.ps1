# Turns Claude Crew live sync off: removes the hook from Claude Code and deletes %LOCALAPPDATA%\ClaudeCrew.
$ErrorActionPreference = 'Stop'
$settingsPath = Join-Path $env:USERPROFILE '.claude\settings.json'
if (Test-Path $settingsPath) {
  $settings = Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($settings.PSObject.Properties['hooks']) {
    foreach ($p in @($settings.hooks.PSObject.Properties)) {
      $settings.hooks.($p.Name) = @(@($p.Value) | Where-Object { -not (($_.hooks | ForEach-Object { $_.command }) -match 'crew-hook\.ps1') })
    }
    [IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 32), (New-Object Text.UTF8Encoding($false)))
  }
}
Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA 'ClaudeCrew') -ErrorAction SilentlyContinue
Write-Host 'Claude Crew live sync is off.' -ForegroundColor Green
