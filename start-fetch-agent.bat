@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Run install-fetch-agent.bat first.
  pause
  exit /b 1
)
if not exist .env.local (
  echo No .env.local - running setup first...
  node scripts/first-run.mjs
)
echo.
echo Fetch Agent running - keep this window open while fetching in the portal.
echo Press Ctrl+C to stop.
echo.
npm start
