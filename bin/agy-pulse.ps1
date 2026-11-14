$ErrorActionPreference = 'Stop'
$CliEntry = Join-Path (Split-Path -Parent $PSScriptRoot) 'dist\cli.cjs'

if (-not (Test-Path -LiteralPath $CliEntry)) {
  [Console]::Error.WriteLine("agy-pulse: CLI bundle not found at $CliEntry")
  exit 127
}

$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) { $NodeCmd = Get-Command agy-node -ErrorAction SilentlyContinue }

if ($NodeCmd) {
  & $NodeCmd.Source $CliEntry @args
  exit $LASTEXITCODE
}

$Candidates = @()
if ($env:APPDATA) { $Candidates += (Join-Path $env:APPDATA 'Antigravity\bin\agy-node.exe') }
if ($env:LOCALAPPDATA) { $Candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\bin\agy-node.exe') }
foreach ($Candidate in $Candidates) {
  if ($Candidate -and (Test-Path -LiteralPath $Candidate)) {
    & $Candidate $CliEntry @args
    exit $LASTEXITCODE
  }
}

[Console]::Error.WriteLine('agy-pulse: neither node nor agy-node.exe was found.')
exit 127
