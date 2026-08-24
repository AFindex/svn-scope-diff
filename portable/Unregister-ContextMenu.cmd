@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Unregister-ContextMenu.ps1"
if errorlevel 1 (
  echo.
  echo Removal failed. See the error above.
)
echo.
pause
