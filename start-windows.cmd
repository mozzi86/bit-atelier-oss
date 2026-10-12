@echo off
rem BIT-Atelier - start on Windows (plan 83-03). Double-click this file.
rem  1. checks Node.js (22.9 or newer)
rem  2. first start only: installs the runtime packages (and builds the app when
rem     dist\ is missing, i.e. when started from a source checkout)
rem  3. runs app + API on http://localhost:3001 and opens the browser
rem Data: the folder "daten" next to this file. Stop: Ctrl+C in this window.
rem Options (environment): API_PORT=<port>, BIT_KEIN_BROWSER=1 (no browser), BIT_FENSTER=0 (browser tab
rem instead of the own app window, plan 93-11). The installed shortcuts start tools\bit-atelier.ps1 instead
rem (no console window); this file stays the visible way, also for the first start.
rem 92-08: when the package installation fails, "npm ping" tells a network problem (no internet, company
rem proxy, blocked registry) from other errors, and the message says what to do in English and German.
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
if errorlevel 1 goto :npm_fehler
goto :build_pruefen

:nur_laufzeit
echo [BIT-Atelier] First start: installing the runtime packages - this takes a few minutes ...
call npm ci --omit=dev --no-audit --no-fund
if errorlevel 1 goto :npm_fehler

:build_pruefen
if exist "dist\index.html" goto :starten
echo [BIT-Atelier] Building the app ...
call npm run build
if errorlevel 1 goto :fehler

:starten
rem 93-13: the default data folder only when neither the environment nor .env names one (node --env-file
rem never overrides a variable that is already set, so setting it here unconditionally ignored .env).
if not defined BIT_DATA_DIR findstr /b /c:"BIT_DATA_DIR=" ".env" >nul 2>nul || if not defined BIT_DATA_DIR set "BIT_DATA_DIR=%~dp0daten"
if not defined BIT_KEIN_BROWSER start "" /b cmd /c ""%~f0" :browser"
echo [BIT-Atelier] Starting on http://localhost:%API_PORT% - stop with Ctrl+C.
node --env-file-if-exists=.env server\index.js --app
if errorlevel 1 pause
exit /b %errorlevel%

:browser
rem Runs in the background: wait until the server answers, then open the browser.
node tools\port-warten.mjs %API_PORT% 120
if errorlevel 1 exit /b 1
rem 93-11: own app window (Edge/Chrome --app), the default browser when neither exists or BIT_FENSTER=0.
node tools\app-fenster.mjs http://localhost:%API_PORT%/
if errorlevel 1 start "" http://localhost:%API_PORT%
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

:npm_fehler
rem A half-installed node_modules would make the next start skip the installation.
if exist "node_modules\" rd /s /q "node_modules"
call npm ping --fetch-timeout=15000 --fetch-retries=0 >nul 2>nul
if not errorlevel 1 goto :fehler
set "BIT_REGISTRY=the npm registry"
for /f "delims=" %%r in ('npm config get registry 2^>nul') do set "BIT_REGISTRY=%%r"
echo.
echo  [BIT-Atelier] The runtime packages could not be downloaded: %BIT_REGISTRY%
echo  is not reachable from this computer (no internet, a company proxy or a firewall).
echo  What helps:
echo   - Behind a company proxy (ask your IT for the address):
echo       npm config set proxy http://proxy.example:8080
echo       npm config set https-proxy http://proxy.example:8080
echo   - Your company has its own package registry:
echo       npm config set registry https://npm.example.com/
echo   - No internet on this computer: install BIT-Atelier on a computer with internet,
echo     then copy the whole folder (including node_modules) to this computer.
echo  Then start this file again.
echo.
echo  (Deutsch: Die Laufzeitpakete konnten nicht geladen werden - die Paketquelle ist von
echo   diesem Rechner aus nicht erreichbar: kein Internet, Firmen-Proxy oder Firewall.
echo   Hinter einem Proxy: die zwei Zeilen "npm config set proxy" / "https-proxy" mit der
echo   Adresse Ihrer IT ausfuehren. Eigene Firmen-Registry: "npm config set registry ...".
echo   Ohne Internet: auf einem Rechner mit Internet installieren und den ganzen Ordner samt
echo   node_modules hierher kopieren. Danach diese Datei erneut starten.)
echo.
pause
exit /b 1

:fehler
echo.
echo  [BIT-Atelier] Installing or building failed - see the messages above.
echo  Fix the cause named there and start this file again.
echo.
pause
exit /b 1
