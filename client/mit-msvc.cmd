@echo off
rem Runs a command inside the MSVC build environment of a Visual Studio
rem installation that really has the C++ tools (Phase 70-02).
rem
rem Why: rustc looks for link.exe on its own and may pick an installation that
rem has the linker but not the C runtime libraries (seen on the build machine:
rem "VS 2022 Community" without the C++ workload next to "Build Tools 2022"
rem -> LNK1104 cannot open file 'msvcrt.lib'). vswhere -requires VC.Tools
rem selects only a complete C++ installation, vcvars64.bat sets LIB/PATH so
rem rustc uses exactly that one.
rem
rem Usage (from the repo root):
rem   client\mit-msvc.cmd npm run client:build
rem   client\mit-msvc.cmd npm run client:check
setlocal
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
  echo FEHLER: vswhere.exe nicht gefunden. Visual Studio Build Tools 2022 mit "Desktopentwicklung mit C++" installieren.
  exit /b 1
)
set "VSPFAD="
for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSPFAD=%%i"
if not defined VSPFAD (
  echo FEHLER: Keine Visual-Studio-Installation mit C++-Werkzeugen gefunden.
  exit /b 1
)
call "%VSPFAD%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
  echo FEHLER: vcvars64.bat aus "%VSPFAD%" ist fehlgeschlagen.
  exit /b 1
)
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
%*
exit /b %errorlevel%
