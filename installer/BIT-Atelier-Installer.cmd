@echo off
rem BIT-Atelier - Windows installer (plan 92-02). Double-click this file.
rem Downloads the latest release of github.com/mozzi86/bit-atelier-oss, verifies its SHA-256,
rem installs it to %LOCALAPPDATA%\BIT-Atelier (no admin rights), keeps an existing "daten" folder,
rem creates Desktop + Start menu shortcuts and starts the app. Later updates come from inside the app.
rem ASCII only on purpose: cmd reads this file in the console code page. The PowerShell part below the
rem marker line is read from this very file, so the installer stays ONE file to download.
setlocal
title BIT-Atelier Installer
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText('%~f0'); $m='#PS-'+'START'; iex $t.Substring($t.IndexOf($m)+$m.Length)"
if errorlevel 1 (
  echo.
  echo  [BIT-Atelier] The installation did not finish - see the messages above.
  pause
  exit /b 1
)
exit /b 0
#PS-START
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Repo   = 'mozzi86/bit-atelier-oss'
$Ziel   = Join-Path $env:LOCALAPPDATA 'BIT-Atelier'
$Temp   = Join-Path $env:TEMP ('bit-atelier-install-' + [guid]::NewGuid().ToString('N'))
$Bewahr = @('daten', '.env')
function Say($t) { Write-Host "[BIT-Atelier] $t" }

# 1. Node.js 22.9 or newer (the app runs on Node; no other runtime is installed).
function NodeOk {
  $n = Get-Command node -ErrorAction SilentlyContinue
  if (-not $n) { return $false }
  $v = (& node -p "process.versions.node").Trim().Split('.')
  return ([int]$v[0] -gt 22) -or ([int]$v[0] -eq 22 -and [int]$v[1] -ge 9)
}
if (-not (NodeOk)) {
  Say 'Node.js 22.9 or newer is needed and was not found.'
  $w = Get-Command winget -ErrorAction SilentlyContinue
  if ($w) {
    $a = Read-Host 'Install Node.js LTS now with winget? (Y/N)  [Deutsch: Node.js jetzt installieren? (J/N)]'
    if ($a -match '^[YyJj]') {
      winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
      $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
    }
  }
  if (-not (NodeOk)) { Say 'Please install Node.js 22 LTS from https://nodejs.org and run this installer again.'; exit 1 }
}

# 2. Latest release + checksum.
Say 'Looking for the latest version ...'
$rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'BIT-Atelier-Installer' }
$zipA = $rel.assets | Where-Object { $_.name -eq 'BIT-Atelier.zip' } | Select-Object -First 1
$shaA = $rel.assets | Where-Object { $_.name -eq 'BIT-Atelier.zip.sha256' } | Select-Object -First 1
if (-not $zipA) { Say 'The release has no BIT-Atelier.zip.'; exit 1 }
New-Item -ItemType Directory -Path $Temp | Out-Null
$zip = Join-Path $Temp 'BIT-Atelier.zip'
Say ("Downloading version {0} ({1:N1} MB) ..." -f $rel.tag_name, ($zipA.size / 1MB))
Invoke-WebRequest -Uri $zipA.browser_download_url -OutFile $zip -UseBasicParsing -Headers @{ 'User-Agent' = 'BIT-Atelier-Installer' }
if ($shaA) {
  $soll = ((Invoke-WebRequest -Uri $shaA.browser_download_url -UseBasicParsing -Headers @{ 'User-Agent' = 'BIT-Atelier-Installer' }).Content | Out-String) -replace '\s.*$',''
  $soll = ([regex]::Match($soll, '[A-Fa-f0-9]{64}')).Value.ToLower()
  $ist  = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
  if ($soll -ne $ist) { Say "Checksum mismatch - download discarded (expected $soll, got $ist)."; Remove-Item -Recurse -Force $Temp; exit 1 }
  Say 'Checksum OK.'
} else {
  Say 'Warning: this release has no checksum file - installing without verification.'
}

# 3. Unpack and install; an existing installation keeps its data.
Expand-Archive -Path $zip -DestinationPath $Temp -Force
$quelle = Join-Path $Temp 'BIT-Atelier'
if (-not (Test-Path (Join-Path $quelle 'package.json'))) { Say 'The download does not contain the app.'; exit 1 }
if (Test-Path $Ziel) {
  Say "Existing installation found in $Ziel - replacing the program, keeping your data."
  Get-ChildItem -Force $Ziel | Where-Object { $Bewahr -notcontains $_.Name } | Remove-Item -Recurse -Force
} else {
  New-Item -ItemType Directory -Path $Ziel | Out-Null
}
Get-ChildItem -Force $quelle | ForEach-Object { Move-Item -Path $_.FullName -Destination $Ziel -Force }
Remove-Item -Recurse -Force $Temp

# 4. Shortcuts (Desktop + Start menu), started through the normal start script.
$sh = New-Object -ComObject WScript.Shell
$icon = Join-Path $Ziel 'public\favicon.ico'
foreach ($ort in @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'))) {
  $l = $sh.CreateShortcut((Join-Path $ort 'BIT-Atelier.lnk'))
  $l.TargetPath = Join-Path $Ziel 'start-windows.cmd'
  $l.WorkingDirectory = $Ziel
  $l.Description = 'BIT-Atelier'
  if (Test-Path $icon) { $l.IconLocation = $icon }
  $l.Save()
}
Say "Installed to $Ziel. Shortcuts: Desktop and Start menu (BIT-Atelier)."
Say 'Starting BIT-Atelier - the first start installs the runtime packages (a few minutes).'
Start-Process -FilePath (Join-Path $Ziel 'start-windows.cmd') -WorkingDirectory $Ziel
exit 0
