@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Register-ContextMenu.ps1"
if errorlevel 1 (
  echo.
  echo Registration failed. See the error above.
)
echo.
pause
