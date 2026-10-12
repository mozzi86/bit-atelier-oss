@echo off
rem BIT-Atelier - open a .bitproj project file (plan 93-10). The installer registers this file as the
rem "open" command of .bitproj (HKCU\Software\Classes\BITAtelier.Projekt). It only finds Node.js and
rem hands the file to tools\datei-oeffnen.mjs, which starts BIT-Atelier when needed and shows the import
rem preview in the app. The window stays open only when something went wrong.
rem ASCII only on purpose: cmd reads this file in the console code page.
setlocal
title BIT-Atelier
where node >nul 2>nul
if errorlevel 1 goto :ohne_node
node "%~dp0datei-oeffnen.mjs" %*
if errorlevel 1 pause
exit /b %errorlevel%

:ohne_node
echo.
echo  BIT-Atelier needs Node.js 22.9 or newer, and Node.js was not found.
echo  (Deutsch: Bitte Node.js 22 LTS von https://nodejs.org installieren.)
echo.
pause
exit /b 1
