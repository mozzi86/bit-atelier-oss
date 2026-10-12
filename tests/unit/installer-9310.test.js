// Unit tests for plan 93-10 (.bitproj file association in both installers) and 93-11 (hidden start as the
// shortcut target) — as DATA, never against the
// real registry or the real ~/.local/share:
//   - BIT-Atelier-Installer.cmd: the two pure PowerShell functions between "# ZUORDNUNG-START/-ENDE"
//     (registry entries + "does the open command still point to this installation?") run in Windows PowerShell
//     with a placeholder install folder; static checks that the writes go to HKCU only, that the install
//     registers after the shortcuts and the uninstall removes only through the ownership check;
//   - install.sh: datei_zuordnen/datei_entfernen run in sh with HOME and ZIEL inside a temp folder.
// The PowerShell parts run on Windows only; skipped elsewhere and when powershell or sh is not available.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const WURZEL = process.cwd();
const CMD = fs.readFileSync(path.join(WURZEL, "installer", "BIT-Atelier-Installer.cmd"), "ascii");
const SH = fs.readFileSync(path.join(WURZEL, "installer", "install.sh"), "ascii");
const gibt = (prog, args) => !spawnSync(prog, args, { encoding: "utf8", windowsHide: true }).error;
const ZIEL = "C:\\Users\\Nutzer\\AppData\\Local\\BIT-Atelier";

describe("installer: .bitproj association (93-10)", () => {
  const ps = CMD.slice(CMD.indexOf("#PS-START"));
  const rein = ps.slice(ps.indexOf("# ZUORDNUNG-START"), ps.indexOf("# ZUORDNUNG-ENDE"));

  it("the pure part only describes, the writes go to HKCU only", () => {
    assert.ok(rein.length > 100, "marker block found");
    assert.doesNotMatch(rein, /Set-Item|New-Item|Remove-Item|New-ItemProperty/, "no registry write inside the data block");
    assert.doesNotMatch(ps, /HKLM:|HKEY_LOCAL_MACHINE|HKCR:/, "never machine-wide");
    assert.match(ps, /\$Klassen = 'HKCU:\\Software\\Classes'/);
    const nachVerknuepfung = ps.indexOf("Zuordnung-Setzen $Ziel");
    assert.ok(nachVerknuepfung > ps.indexOf("$l.Save()"), "registered after the shortcuts");
    const entfernen = ps.slice(ps.indexOf("# 0. Uninstall"), ps.indexOf("# 1. Node.js"));
    assert.match(entfernen, /Zuordnung-Entfernen \$Ziel/);
    const fn = ps.slice(ps.indexOf("function Zuordnung-Entfernen"), ps.indexOf("# 0. Uninstall"));
    assert.ok(fn.indexOf("Zuordnung-Gehoert") < fn.indexOf("Remove-Item"), "ownership checked before removing");
    assert.match(fn, /GetValue\(''\) -eq \$ProgId/, ".bitproj only removed while it names our ProgID");
    assert.match(ps, /SHChangeNotify\(0x08000000/, "Explorer is told about the change");
  });

  it("registry entries and ownership check (PowerShell, no registry access)", (t) => {
    // Windows-only: the functions build C:\ paths and read %SystemRoot%; pwsh on Linux has neither,
    // so Join-Path yields nothing there (seen in the v1.2.0 release run on ubuntu-latest).
    if (process.platform !== "win32") { t.skip("Windows installer functions (drive letters, %SystemRoot%)"); return; }
    const prog = "powershell";
    if (!gibt(prog, ["-NoProfile", "-Command", "exit 0"])) { t.skip(`${prog} not available`); return; }
    const skript = [
      "iex $env:BIT_REIN",
      "$z = $env:BIT_ZIEL",
      "$neu = (Zuordnung-Eintraege $z | Where-Object { $_.Schluessel -like '*command' }).Wert",
      "[pscustomobject]@{",
      "  e = @(Zuordnung-Eintraege $z)",
      "  eigen = (Zuordnung-Gehoert $neu $z)",
      "  eigenAlt = (Zuordnung-Gehoert ('\"' + $z + '\\tools\\datei-oeffnen.cmd\" \"%1\"') $z)",
      "  fremd = (Zuordnung-Gehoert ($neu -replace 'Nutzer', 'Andere') $z)",
      "  fremdAlt = (Zuordnung-Gehoert '\"C:\\Programme\\Anderes\\tools\\datei-oeffnen.cmd\" \"%1\"' $z)",
      "  leer = (Zuordnung-Gehoert '' $z)",
      "} | ConvertTo-Json -Depth 4 -Compress",
    ].join("\n");
    const r = spawnSync(prog, ["-NoProfile", "-Command", skript], { encoding: "utf8", windowsHide: true, env: { ...process.env, BIT_REIN: rein, BIT_ZIEL: ZIEL } });
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout.trim());
    const wert = (k, n = "") => o.e.find((x) => x.Schluessel === k && x.Name === n)?.Wert;
    assert.equal(wert(".bitproj"), "BITAtelier.Projekt");
    assert.equal(wert(".bitproj", "Content Type"), "application/x-bitproj");
    assert.equal(wert("BITAtelier.Projekt"), "BIT-Atelier-Projekt");
    assert.equal(wert("BITAtelier.Projekt\\DefaultIcon"), `${ZIEL}\\public\\favicon.ico,0`);
    // 93-11: the open command runs the hidden PowerShell start with -Datei.
    assert.match(wert("BITAtelier.Projekt\\shell\\open\\command"),
      /^"[^"]*\\WindowsPowerShell\\v1\.0\\powershell\.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\\Users\\Nutzer\\AppData\\Local\\BIT-Atelier\\tools\\bit-atelier\.ps1" -Datei "%1"$/);
    assert.deepEqual([o.eigen, o.eigenAlt, o.fremd, o.fremdAlt, o.leer], [true, true, false, false, false]);
  });

  it("shortcut target: hidden start when the release has it, start-windows.cmd otherwise (93-11)", (t) => {
    // Windows-only: the functions build C:\ paths and read %SystemRoot%; pwsh on Linux has neither,
    // so Join-Path yields nothing there (seen in the v1.2.0 release run on ubuntu-latest).
    if (process.platform !== "win32") { t.skip("Windows installer functions (drive letters, %SystemRoot%)"); return; }
    const prog = "powershell";
    if (!gibt(prog, ["-NoProfile", "-Command", "exit 0"])) { t.skip(`${prog} not available`); return; }
    // A throw-away app folder: Verknuepfung-Ziel only checks whether tools\bit-atelier.ps1 exists.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-9311-lnk-"));
    try {
      const skript = "iex $env:BIT_REIN; Verknuepfung-Ziel $env:BIT_ZIEL | ConvertTo-Json -Compress";
      const lauf = () => {
        const r = spawnSync(prog, ["-NoProfile", "-Command", skript], { encoding: "utf8", windowsHide: true, env: { ...process.env, BIT_REIN: rein, BIT_ZIEL: tmp } });
        assert.equal(r.status, 0, r.stderr);
        return JSON.parse(r.stdout.trim());
      };
      const alt = lauf();
      assert.equal(alt.Ziel, path.join(tmp, "start-windows.cmd"));
      assert.equal(alt.Fensterstil, 1);
      fs.mkdirSync(path.join(tmp, "tools"));
      fs.writeFileSync(path.join(tmp, "tools", "bit-atelier.ps1"), "");
      const neu = lauf();
      assert.match(neu.Ziel, /powershell\.exe$/i);
      assert.equal(neu.Argumente, `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${path.join(tmp, "tools", "bit-atelier.ps1")}"`);
      assert.equal(neu.Fensterstil, 7, "minimized: no console flash");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("install.sh: Linux MIME type + desktop entry in a sandbox HOME, removed again", (t) => {
    if (!gibt("sh", ["-c", "exit 0"])) { t.skip("sh not available"); return; }
    assert.match(SH, /datei_entfernen\n/, "uninstall calls it");
    const block = SH.slice(SH.indexOf('MIME_XML="'), SH.indexOf("\nentfernen() {"));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-9310-sh-"));
    try {
      const ziel = path.join(tmp, "BIT-Atelier").replace(/\\/g, "/");
      fs.mkdirSync(path.join(tmp, "BIT-Atelier", "tools"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "BIT-Atelier", "tools", "datei-oeffnen.sh"), "#!/bin/sh\n");
      const home = path.join(tmp, "home").replace(/\\/g, "/");
      const skript = `say() { echo "$*"; }\nPATH=/usr/bin:/bin\n${block}\ndatei_zuordnen\ncat "$DATEI_DESKTOP"\necho ---\ncat "$MIME_XML"\necho ---\ndatei_entfernen\nls "$HOME/.local/share/applications" | wc -l\n`;
      const r = spawnSync("sh", ["-c", skript], { encoding: "utf8", env: { ...process.env, HOME: home, ZIEL: ziel } });
      assert.equal(r.status, 0, r.stderr);
      const [desktop, mime, rest] = r.stdout.split("---\n");
      assert.match(desktop, new RegExp(`Exec=sh "${ziel}/tools/datei-oeffnen.sh" %f`));
      assert.match(desktop, /MimeType=application\/x-bitproj;/);
      assert.match(desktop, /NoDisplay=true/);
      assert.match(mime, /<glob pattern="\*\.bitproj"\/>/);
      assert.match(rest, /Removed the \.bitproj file association\.\n\s*0\s*$/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
