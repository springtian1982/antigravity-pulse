$ErrorActionPreference = 'Stop'
$CliEntry = Join-Path (Split-Path -Parent $PSScriptRoot) 'dist\cli.cjs'

$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) { $NodeCmd = Get-Command agy-node -ErrorAction SilentlyContinue }

if ($NodeCmd) {
  & $NodeCmd.Source $CliEntry @args
  exit $LASTEXITCODE
}

$Candidates = @(
  (Join-Path $env:APPDATA 'Antigravity\bin\agy-node.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\bin\agy-node.exe')
)
foreach ($Candidate in $Candidates) {
  if ($Candidate -and (Test-Path $Candidate)) {
    & $Candidate $CliEntry @args
    exit $LASTEXITCODE
  }
}

Write-Error 'agy-pulse: neither node nor agy-node.exe was found.'
exit 127
