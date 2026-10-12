@echo off
rem BIT-Atelier - Windows installer (plan 92-02). Double-click this file.
rem Downloads the latest release of github.com/mozzi86/bit-atelier-oss, verifies its SHA-256,
rem installs it to %LOCALAPPDATA%\BIT-Atelier (no admin rights), keeps an existing "daten" folder,
rem creates Desktop + Start menu shortcuts and starts the app. Later updates come from inside the app.
rem Uninstall (plan 92-06): BIT-Atelier-Installer.cmd /entfernen  (or /uninstall) - stops a running
rem BIT-Atelier, asks whether the data folder stays (default: yes), removes program, .update, node_modules
rem and the shortcuts. The Start menu entry "BIT-Atelier entfernen" runs exactly this.
rem File association (plan 93-10): .bitproj -> ProgID BITAtelier.Projekt under HKCU\Software\Classes (per user,
rem no admin), icon public\favicon.ico, "open" runs tools\bit-atelier.ps1 -Datei "%1" hidden. The uninstall
rem removes these keys only while they still point to this installation.
rem App window (plan 93-11): the shortcuts start tools\bit-atelier.ps1 through a hidden PowerShell - no console
rem window, the app in its own Edge/Chrome window; the first start still shows start-windows.cmd (packages).
rem ASCII only on purpose: cmd reads this file in the console code page. The PowerShell part below the
rem marker line is read from this very file, so the installer stays ONE file to download.
setlocal
title BIT-Atelier Installer
set "BIT_INSTALLER_ARGS=%*"
if /i "%~1"=="/entfernen" goto :entfernen
if /i "%~1"=="/uninstall" goto :entfernen
goto :los

:entfernen
rem The installed copy of this file lies inside the folder it removes, and cmd reads a batch file line by
rem line while it runs - so run a copy from %TEMP% (a batch started without "call" never comes back here).
if /i "%~nx0"=="BIT-Atelier-Entfernen.cmd" goto :los
copy /y "%~f0" "%TEMP%\BIT-Atelier-Entfernen.cmd" >nul
"%TEMP%\BIT-Atelier-Entfernen.cmd" %*

:los
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText('%~f0'); $m='#PS-'+'START'; iex $t.Substring($t.IndexOf($m)+$m.Length)"
if errorlevel 1 (
  echo.
  echo  [BIT-Atelier] Not finished - see the messages above.
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
$Startmenue = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'
$Links = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'BIT-Atelier.lnk'), (Join-Path $Startmenue 'BIT-Atelier.lnk'), (Join-Path $Startmenue 'BIT-Atelier entfernen.lnk'))

# ZUORDNUNG-START (93-10, 93-11) - the .bitproj association and the shortcut target as DATA;
# tests/unit/installer-9310.test.js runs these functions without touching the registry or the Desktop.
# Everything below HKCU:\Software\Classes (per user, no admin).
$ProgId = 'BITAtelier.Projekt'
function Versteckt-Befehl($ziel) {
  # 93-11: Windows PowerShell runs tools\bit-atelier.ps1 hidden - no console window (no .vbs: VBScript is
  # being retired by Windows). Returns the program and its arguments.
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  [pscustomobject]@{ Programm = $ps; Argumente = ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $ziel 'tools\bit-atelier.ps1') + '"') }
}
function Verknuepfung-Ziel($ziel) {
  # Desktop/Start menu shortcut: the hidden start when the release has it, else start-windows.cmd as before.
  # Fensterstil 7 = minimized, so not even the PowerShell window flashes before it hides itself.
  if (Test-Path -LiteralPath (Join-Path $ziel 'tools\bit-atelier.ps1')) {
    $v = Versteckt-Befehl $ziel
    return [pscustomobject]@{ Ziel = $v.Programm; Argumente = $v.Argumente; Fensterstil = 7 }
  }
  [pscustomobject]@{ Ziel = (Join-Path $ziel 'start-windows.cmd'); Argumente = ''; Fensterstil = 1 }
}
function Zuordnung-Eintraege($ziel) {
  $v = Versteckt-Befehl $ziel
  $befehl = '"' + $v.Programm + '" ' + $v.Argumente + ' -Datei "%1"'
  @(
    [pscustomobject]@{ Schluessel = '.bitproj'; Name = ''; Wert = $ProgId },
    [pscustomobject]@{ Schluessel = '.bitproj'; Name = 'Content Type'; Wert = 'application/x-bitproj' },
    [pscustomobject]@{ Schluessel = $ProgId; Name = ''; Wert = 'BIT-Atelier-Projekt' },
    [pscustomobject]@{ Schluessel = $ProgId; Name = 'FriendlyTypeName'; Wert = 'BIT-Atelier-Projekt' },
    [pscustomobject]@{ Schluessel = "$ProgId\DefaultIcon"; Name = ''; Wert = ((Join-Path $ziel 'public\favicon.ico') + ',0') },
    [pscustomobject]@{ Schluessel = "$ProgId\shell\open\command"; Name = ''; Wert = $befehl }
  )
}
function Zuordnung-Gehoert($befehl, $ziel) {
  # True only when the registered open command still starts THIS installation's launcher - the hidden
  # PowerShell form (93-11) or the .cmd form of 93-10.
  if ([string]::IsNullOrWhiteSpace($befehl)) { return $false }
  $b = $befehl.Trim().ToLowerInvariant()
  $skript = ('-File "' + (Join-Path $ziel 'tools\bit-atelier.ps1') + '"').ToLowerInvariant()
  $cmd = ('"' + (Join-Path $ziel 'tools\datei-oeffnen.cmd') + '"').ToLowerInvariant()
  return $b.Contains($skript) -or $b.StartsWith($cmd)
}
# ZUORDNUNG-ENDE
$Klassen = 'HKCU:\Software\Classes'
function Shell-Melden {
  # SHChangeNotify(SHCNE_ASSOCCHANGED): Explorer picks up the new icon and "open" command at once.
  try {
    if (-not ('BitAtelier.Shell' -as [type])) {
      Add-Type -Namespace BitAtelier -Name Shell -MemberDefinition '[System.Runtime.InteropServices.DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, System.IntPtr a, System.IntPtr b);'
    }
    [BitAtelier.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
  } catch {
    Say 'Explorer shows the .bitproj icon after a refresh (F5) or the next sign-in.'
  }
}
function Zuordnung-Setzen($ziel) {
  foreach ($e in (Zuordnung-Eintraege $ziel)) {
    $k = Join-Path $Klassen $e.Schluessel
    if (-not (Test-Path -LiteralPath $k)) { New-Item -Path $k -Force | Out-Null }
    if ($e.Name -eq '') { Set-Item -LiteralPath $k -Value $e.Wert }
    else { New-ItemProperty -LiteralPath $k -Name $e.Name -Value $e.Wert -PropertyType String -Force | Out-Null }
  }
  Shell-Melden
}
function Zuordnung-Entfernen($ziel) {
  $cmdKey = Join-Path $Klassen "$ProgId\shell\open\command"
  $befehl = $null
  if (Test-Path -LiteralPath $cmdKey) { $befehl = (Get-Item -LiteralPath $cmdKey).GetValue('') }
  if (-not $befehl) { return }
  if (-not (Zuordnung-Gehoert $befehl $ziel)) { Say 'The .bitproj association belongs to another installation - left unchanged.'; return }
  Remove-Item -LiteralPath (Join-Path $Klassen $ProgId) -Recurse -Force
  $ext = Join-Path $Klassen '.bitproj'
  if ((Test-Path -LiteralPath $ext) -and ((Get-Item -LiteralPath $ext).GetValue('') -eq $ProgId)) { Remove-Item -LiteralPath $ext -Recurse -Force }
  Shell-Melden
  Say 'Removed the .bitproj file association.'
}

# 0. Uninstall (92-06): BIT-Atelier-Installer.cmd /entfernen
function Frage($text, $vorgabe) {
  $a = Read-Host $text
  if ([string]::IsNullOrWhiteSpace($a)) { return $vorgabe }
  return ($a -match '^[YyJj]')
}
function Weg($pfad) {
  # Remove-Item can stumble over deep node_modules paths; rd is the fallback.
  try { Remove-Item -LiteralPath $pfad -Recurse -Force -ErrorAction Stop } catch { cmd /c "rd /s /q `"$pfad`"" 2>$null; if (Test-Path -LiteralPath $pfad) { Remove-Item -LiteralPath $pfad -Force -ErrorAction SilentlyContinue } }
}
if ("$env:BIT_INSTALLER_ARGS" -match '(^|\s)[/-]{1,2}(entfernen|uninstall)(\s|$)') {
  $Port = 3001
  if ($env:API_PORT) { $Port = [int]$env:API_PORT }
  Say "Uninstalling BIT-Atelier from $Ziel  [Deutsch: BIT-Atelier wird entfernt]"
  # a) Stop a running BIT-Atelier (only when the port really answers as BIT-Atelier), with its console.
  $status = $null
  try { $status = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/status" -TimeoutSec 3 } catch { $status = $null }
  if ($status -and $status.name -eq 'bit-atelier') {
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) {
      $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"
      if ($p) {
        $e = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"
        if ($e -and $e.Name -eq 'cmd.exe') { Stop-Process -Id $e.ProcessId -Force -ErrorAction SilentlyContinue }
      }
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
      Say "Stopped the running BIT-Atelier (port $Port)."
    }
  }
  # b) The data folder: kept unless the user says otherwise; a backup copy is offered before deleting.
  $Daten = Join-Path $Ziel 'daten'
  $behalten = $true
  if (Test-Path -LiteralPath $Daten) {
    Say "Your data folder (projects, settings): $Daten"
    $behalten = Frage 'Keep your data? (Y/n)  [Deutsch: Daten behalten? (J/n)]' $true
    if (-not $behalten) {
      if (Frage 'Copy a backup of the data to your Desktop first? (Y/n)  [Deutsch: Vorher Sicherung auf den Desktop kopieren? (J/n)]' $true) {
        $kopie = Join-Path ([Environment]::GetFolderPath('Desktop')) ('BIT-Atelier-Daten-' + (Get-Date -Format 'yyyy-MM-dd-HHmm'))
        Copy-Item -LiteralPath $Daten -Destination $kopie -Recurse
        Say "Backup copied to $kopie"
      }
      if (-not (Frage 'Really delete the data folder? This cannot be undone. (y/N)  [Deutsch: Daten wirklich loeschen? (j/N)]' $false)) { $behalten = $true; Say 'Data kept.' }
    }
  }
  # c) Program files, .update, node_modules - everything except daten and .env when the data stay.
  if (Test-Path -LiteralPath $Ziel) {
    Get-ChildItem -Force -LiteralPath $Ziel | Where-Object { -not ($behalten -and ($Bewahr -contains $_.Name)) } | ForEach-Object { Weg $_.FullName }
    if (-not $behalten) { Weg $Ziel }
  } else {
    Say "No installation found in $Ziel."
  }
  # d) Shortcuts and the .bitproj association (93-10, only when it still points here).
  foreach ($l in $Links) { if (Test-Path -LiteralPath $l) { Remove-Item -LiteralPath $l -Force } }
  Zuordnung-Entfernen $Ziel
  $rest = @()
  if (Test-Path -LiteralPath $Ziel) { $rest = @(Get-ChildItem -Force -LiteralPath $Ziel | Where-Object { -not ($behalten -and ($Bewahr -contains $_.Name)) }) }
  if ($rest.Count -gt 0) {
    Say ("Not everything could be removed (still open?): " + (($rest | ForEach-Object { $_.Name }) -join ', ') + " in $Ziel")
    Read-Host 'Press Enter to close  [Enter = schliessen]' | Out-Null
    exit 1
  }
  if ($behalten -and (Test-Path -LiteralPath $Daten)) {
    Say "BIT-Atelier was removed. Your data stay in $Daten - installing again picks them up.  [Deutsch: Programm entfernt, Daten bleiben.]"
  } else {
    Say 'BIT-Atelier and its data were removed.  [Deutsch: Programm und Daten entfernt.]'
  }
  Read-Host 'Press Enter to close  [Enter = schliessen]' | Out-Null
  exit 0
}

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

# 4. Shortcuts (Desktop + Start menu) with the BIT icon. 93-11: they start BIT-Atelier hidden in its own app
# window (tools\bit-atelier.ps1); a release without that script keeps start-windows.cmd.
$sh = New-Object -ComObject WScript.Shell
$icon = Join-Path $Ziel 'public\favicon.ico'
$vz = Verknuepfung-Ziel $Ziel
foreach ($ort in @([Environment]::GetFolderPath('Desktop'), $Startmenue)) {
  $l = $sh.CreateShortcut((Join-Path $ort 'BIT-Atelier.lnk'))
  $l.TargetPath = $vz.Ziel
  $l.Arguments = $vz.Argumente
  $l.WindowStyle = $vz.Fensterstil
  $l.WorkingDirectory = $Ziel
  $l.Description = 'BIT-Atelier'
  if (Test-Path $icon) { $l.IconLocation = $icon }
  $l.Save()
}
# 92-06: Start menu entry for the uninstall - the installed copy of this file with /entfernen.
$selbst = Join-Path $Ziel 'installer\BIT-Atelier-Installer.cmd'
if (Test-Path $selbst) {
  $u = $sh.CreateShortcut((Join-Path $Startmenue 'BIT-Atelier entfernen.lnk'))
  $u.TargetPath = $selbst
  $u.Arguments = '/entfernen'
  $u.WorkingDirectory = $env:TEMP
  $u.Description = 'BIT-Atelier entfernen (uninstall)'
  $u.Save()
}
# 93-10: double-click on a .bitproj opens it in BIT-Atelier (per user, HKCU; older releases lack the launcher).
if ((Test-Path (Join-Path $Ziel 'tools\datei-oeffnen.mjs')) -and (Test-Path (Join-Path $Ziel 'tools\bit-atelier.ps1'))) {
  Zuordnung-Setzen $Ziel
  Say 'File type .bitproj registered: a double-click opens the project in BIT-Atelier.'
}
Say "Installed to $Ziel. Shortcuts: Desktop and Start menu (BIT-Atelier, BIT-Atelier entfernen)."
Say 'Starting BIT-Atelier - the first start installs the runtime packages (a few minutes).'
Start-Process -FilePath (Join-Path $Ziel 'start-windows.cmd') -WorkingDirectory $Ziel
exit 0
