// Unit tests for plan 92-06 (uninstall switch of both installers) and the file rules every installer change
// must keep: BIT-Atelier-Installer.cmd is pure ASCII with CRLF only (cmd reads it in the console code page and
// misreads labels with bare LF), its PowerShell part (after the marker) parses without errors; install.sh is
// ASCII with LF only and passes `sh -n`; both know the uninstall switch, and the public READMEs document it.
// The PowerShell parse runs with powershell (Windows) or pwsh (elsewhere) and is skipped when neither exists;
// `sh -n` is skipped without a POSIX shell.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const WURZEL = process.cwd();
const CMD = path.join(WURZEL, "installer", "BIT-Atelier-Installer.cmd");
const SH = path.join(WURZEL, "installer", "install.sh");

/** Is a program callable? */
const gibt = (prog, args) => !spawnSync(prog, args, { encoding: "utf8", windowsHide: true }).error;

describe("installer files (92-06)", () => {
  it("BIT-Atelier-Installer.cmd: ASCII, CRLF only, uninstall switch before the PowerShell part", () => {
    const roh = fs.readFileSync(CMD);
    assert.ok(roh.every((b) => b < 0x80), "pure ASCII");
    const text = roh.toString("ascii");
    assert.equal(/(^|[^\r])\n/.test(text), false, "no bare LF");
    assert.equal(text.split("#PS-START").length, 2, "marker exactly once");
    const kopf = text.slice(0, text.indexOf("#PS-START"));
    assert.match(kopf, /set "BIT_INSTALLER_ARGS=%\*"/);
    assert.match(kopf, /if \/i "%~1"=="\/entfernen" goto :entfernen/);
    assert.match(kopf, /BIT-Atelier-Entfernen\.cmd/, "runs the uninstall from a %TEMP% copy");
    const ps = text.slice(text.indexOf("#PS-START"));
    assert.match(ps, /entfernen\|uninstall/);
    assert.match(ps, /'BIT-Atelier entfernen\.lnk'/, "Start menu entry for the uninstall");
  });

  it("the PowerShell part parses", (t) => {
    const prog = process.platform === "win32" ? "powershell" : "pwsh";
    if (!gibt(prog, ["-NoProfile", "-Command", "exit 0"])) { t.skip(`${prog} not available`); return; }
    const skript = "$t=[IO.File]::ReadAllText($env:BIT_CMD); $m='#PS-'+'START'; $ps=$t.Substring($t.IndexOf($m)+$m.Length); $e=$null; [void][System.Management.Automation.Language.Parser]::ParseInput($ps,[ref]$null,[ref]$e); foreach($x in $e){ $x.Message + ' @' + $x.Extent.StartLineNumber }; exit $e.Count";
    const r = spawnSync(prog, ["-NoProfile", "-Command", skript], { encoding: "utf8", windowsHide: true, env: { ...process.env, BIT_CMD: CMD } });
    assert.equal(r.status, 0, `parse errors:\n${r.stdout}${r.stderr}`);
  });

  it("install.sh: ASCII, LF only, sh -n, uninstall switch", (t) => {
    const roh = fs.readFileSync(SH);
    assert.ok(roh.every((b) => b < 0x80), "pure ASCII");
    const text = roh.toString("ascii");
    assert.equal(text.includes("\r"), false, "LF only");
    assert.match(text, /--entfernen\|--uninstall\) entfernen; exit 0/);
    if (!gibt("sh", ["-c", "exit 0"])) { t.skip("sh not available"); return; }
    const r = spawnSync("sh", ["-n", SH], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  });

  it("the public READMEs document the uninstall", () => {
    for (const datei of ["README.md", "README.de.md"]) {
      // Private repo: oss/<file>; public export: the overlay is the root (scripts/oss-export.mjs OVERLAY_DIR).
      const quelle = fs.existsSync(path.join(WURZEL, "oss", datei)) ? path.join(WURZEL, "oss", datei) : path.join(WURZEL, datei);
      const text = fs.readFileSync(quelle, "utf8");
      assert.match(text, /BIT-Atelier-Installer\.cmd \/entfernen/, datei);
      assert.match(text, /install\.sh --entfernen/, datei);
    }
  });
});
