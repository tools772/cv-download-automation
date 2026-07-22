@echo off
cd /d "%~dp0"
echo.
echo Perfect Ventures Fetch Agent - Install
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org ^(18+^)
  pause
  exit /b 1
)
node scripts/first-run.mjs
echo.
pause
