@echo off
setlocal
cd /d "%~dp0"

echo BIM Personal Agent V0.8.0 User Installer
echo No Node.js, npm, Python, or .NET SDK installation is required.
echo Close Revit and Codex Desktop before continuing.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-release.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo Installation did not complete. Review the message above.
) else (
  echo Installation completed.
)

pause
exit /b %EXIT_CODE%
