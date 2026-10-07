@echo off
rem BIT-Atelier - start on Windows (plan 83-03). Double-click this file.
rem  1. checks Node.js (22.9 or newer)
rem  2. first start only: installs the runtime packages (and builds the app when
rem     dist\ is missing, i.e. when started from a source checkout)
rem  3. runs app + API on http://localhost:3001 and opens the browser
rem Data: the folder "daten" next to this file. Stop: Ctrl+C in this window.
rem Options (environment): API_PORT=<port>, BIT_KEIN_BROWSER=1 (no browser).
rem ASCII only on purpose: cmd reads this file in the console code page.
setlocal
cd /d "%~dp0"
if "%~1"==":browser" goto :browser
title BIT-Atelier
if not defined API_PORT set "API_PORT=3001"

where node >nul 2>nul
if errorlevel 1 goto :ohne_node
node -e "var v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=9)?0:1)"
if errorlevel 1 goto :node_alt

if exist "node_modules\" goto :build_pruefen
if exist "dist\index.html" goto :nur_laufzeit
echo [BIT-Atelier] First start from source: installing packages and building the app - this takes several minutes ...
call npm ci --no-audit --no-fund
if errorlevel 1 goto :fehler
goto :build_pruefen

:nur_laufzeit
echo [BIT-Atelier] First start: installing the runtime packages - this takes a few minutes ...
call npm ci --omit=dev --no-audit --no-fund
if errorlevel 1 goto :fehler

:build_pruefen
if exist "dist\index.html" goto :starten
echo [BIT-Atelier] Building the app ...
call npm run build
if errorlevel 1 goto :fehler

:starten
set "BIT_DATA_DIR=%~dp0daten"
if not defined BIT_KEIN_BROWSER start "" /b cmd /c ""%~f0" :browser"
echo [BIT-Atelier] Starting on http://localhost:%API_PORT% - stop with Ctrl+C.
node --env-file-if-exists=.env server\index.js --app
if errorlevel 1 pause
exit /b %errorlevel%

:browser
rem Runs in the background: wait until the server answers, then open the browser.
node tools\port-warten.mjs %API_PORT% 120
if errorlevel 1 exit /b 1
start "" http://localhost:%API_PORT%
exit /b 0

:ohne_node
echo.
echo  BIT-Atelier needs Node.js 22.9 or newer, and Node.js was not found.
echo  Install the LTS version from https://nodejs.org and start this file again.
echo  (Deutsch: Bitte Node.js 22 LTS von https://nodejs.org installieren.)
echo.
pause
exit /b 1

:node_alt
echo.
for /f "delims=" %%v in ('node --version') do echo  Found Node.js %%v - BIT-Atelier needs 22.9 or newer.
echo  Install the current LTS version from https://nodejs.org and start this file again.
echo  (Deutsch: Bitte Node.js 22 LTS von https://nodejs.org installieren.)
echo.
pause
exit /b 1

:fehler
echo.
echo  [BIT-Atelier] Installing or building failed - see the messages above.
echo  Check the internet connection and start this file again.
echo.
pause
exit /b 1
