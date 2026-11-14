@echo off
setlocal
set "CLI_ENTRY=%~dp0..\dist\cli.cjs"

if not exist "%CLI_ENTRY%" (
  echo agy-pulse: CLI bundle not found at "%CLI_ENTRY%" 1>&2
  exit /b 127
)

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  node "%CLI_ENTRY%" %*
  exit /b %ERRORLEVEL%
)

where agy-node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  agy-node "%CLI_ENTRY%" %*
  exit /b %ERRORLEVEL%
)

if defined APPDATA if exist "%APPDATA%\Antigravity\bin\agy-node.exe" (
  "%APPDATA%\Antigravity\bin\agy-node.exe" "%CLI_ENTRY%" %*
  exit /b %ERRORLEVEL%
)

if defined LOCALAPPDATA if exist "%LOCALAPPDATA%\Programs\Antigravity\bin\agy-node.exe" (
  "%LOCALAPPDATA%\Programs\Antigravity\bin\agy-node.exe" "%CLI_ENTRY%" %*
  exit /b %ERRORLEVEL%
)

echo agy-pulse: neither node nor agy-node.exe was found. 1>&2
exit /b 127
