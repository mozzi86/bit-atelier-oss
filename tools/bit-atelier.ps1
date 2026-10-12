# BIT-Atelier - start without a console window (plan 93-11). The Desktop and Start menu shortcuts run
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "<app>\tools\bit-atelier.ps1"
# and the .bitproj "open" command (plan 93-10) adds  -Datei "%1".
# This script runs hidden; Node runs in the same hidden console. tools\app-start.mjs uses a running
# BIT-Atelier or starts the server hidden (output in daten\server.log) and opens the app window; only the
# very first start shows a window (start-windows.cmd installs the packages there, with progress).
# Every failure ends in a message box - a hidden script must never fail silently.
# ASCII only on purpose (Windows PowerShell 5.1 reads a file without BOM in the ANSI code page).
param([string]$Datei = '')
$ErrorActionPreference = 'Continue'
$App = Split-Path -Parent $PSScriptRoot

function Meldung([string]$text) {
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show($text, 'BIT-Atelier', 'OK', 'Warning')
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Meldung "BIT-Atelier needs Node.js 22.9 or newer, and Node.js was not found.`r`nInstall the LTS version from https://nodejs.org.`r`n`r`nDeutsch: Bitte Node.js 22 LTS von https://nodejs.org installieren."
  exit 1
}
& node -e "var v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=9)?0:1)"
if ($LASTEXITCODE -ne 0) {
  Meldung ("Found Node.js " + (& node --version) + " - BIT-Atelier needs 22.9 or newer (https://nodejs.org).`r`n`r`nDeutsch: Bitte Node.js 22 LTS installieren.")
  exit 1
}

Set-Location -LiteralPath $App
if ($Datei) {
  $ausgabe = & node (Join-Path $App 'tools\datei-oeffnen.mjs') $Datei 2>&1
} else {
  $ausgabe = & node (Join-Path $App 'tools\app-start.mjs') 2>&1
}
if ($LASTEXITCODE -ne 0) {
  $text = ($ausgabe | ForEach-Object { "$_" }) -join "`r`n"
  Meldung ($text.Trim() + "`r`n`r`nDetails: daten\server.log")
  exit 1
}
exit 0
