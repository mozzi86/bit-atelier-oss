// 112-01 task 5 (foreign review 08.11.2026, point 6): scripts.
//   - install.sh (uninstall): after kill it waits up to 15 s (kill -0) for the server to end and stops with a plain-text
//     message - nothing copied or deleted - when it is still running. The loop runs for real in sh (with the limit
//     shortened to 1 s so the test stays fast): a process that ends → "Stopped", one that ignores TERM → exit 1.
//   - BIT-Atelier-Installer.cmd (same pattern, rule 8): Get-Process loop up to 15 s instead of a fixed Start-Sleep 2,
//     exit 1 before the data step.
//   - tools/bit-atelier.ps1: [Console]::OutputEncoding = UTF-8 before the node calls; still pure ASCII with CRLF. On
//     Windows a real PowerShell run proves that captured node output keeps an umlaut with that line.
//
// In:  installer/install.sh, installer/BIT-Atelier-Installer.cmd, tools/bit-atelier.ps1. Out: assertions only.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const SH = fs.readFileSync(path.join(WURZEL, "installer", "install.sh"), "ascii");
const CMD = fs.readFileSync(path.join(WURZEL, "installer", "BIT-Atelier-Installer.cmd"), "ascii");
const PS1 = fs.readFileSync(path.join(WURZEL, "tools", "bit-atelier.ps1"));
const gibt = (prog, args) => !spawnSync(prog, args, { encoding: "utf8", windowsHide: true }).error;

describe("install.sh: wait for the server before copying or deleting", () => {
  const entfernen = SH.slice(SH.indexOf("\nentfernen() {"));
  const funktion = SH.slice(SH.indexOf("laeuft_noch() {"), SH.indexOf("\nentfernen() {"));
  const warteBlock = entfernen.slice(entfernen.indexOf("    kill $PIDS"), entfernen.indexOf('    say "Stopped the running BIT-Atelier'));

  it("order: kill, wait loop (15 s), abort with exit 1 - all before the data step", () => {
    assert.match(funktion, /kill -0 "\$P"/);
    assert.doesNotMatch(entfernen.slice(0, entfernen.indexOf("# b)")), /\n\s*sleep 2\n/, "the fixed sleep 2 is gone");
    assert.match(warteBlock, /while laeuft_noch \$PIDS && \[ "\$WARTEZEIT" -lt 15 \]/);
    assert.match(warteBlock, /if laeuft_noch \$PIDS; then[\s\S]*nothing was copied or deleted[\s\S]*exit 1/);
    assert.ok(entfernen.indexOf("exit 1\n    fi\n    say \"Stopped") < entfernen.indexOf("cp -R"), "abort before the backup copy");
    assert.ok(entfernen.indexOf("exit 1\n    fi\n    say \"Stopped") < entfernen.indexOf("rm -rf"), "abort before deleting");
  });

  /**
   * Runs the real wait block against one background process (limit 15 s → 1 s).
   * @param {string} prozess shell command started in the background
   * @returns {import('node:child_process').SpawnSyncReturns<string>}
   */
  const laufe = (prozess) => {
    const block = warteBlock.replace('-lt 15 ]', '-lt 1 ]');
    // The helper is always killed on exit (also after the block's own `exit 1`) and never holds the output pipe.
    const skript = `say() { echo "$*"; }\n${funktion}\n${prozess} >/dev/null 2>&1 &\nPIDS=$!\ntrap 'kill -9 $PIDS 2>/dev/null' EXIT\nsleep 0.3\nentfernen_test() {\n${block}\n    say "Stopped"\n}\nentfernen_test\nexit 0\n`;
    return spawnSync("sh", ["-c", skript], { encoding: "utf8", timeout: 20000 });
  };

  it("a server that ends is waited for, then the step goes on", (t) => {
    if (!gibt("sh", ["-c", "exit 0"])) { t.skip("sh not available"); return; }
    const r = laufe("sleep 30");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Stopped/);
  });

  it("a server that does not end: plain-text message, exit 1, nothing after it runs", (t) => {
    if (!gibt("sh", ["-c", "exit 0"])) { t.skip("sh not available"); return; }
    // exec: the TERM-ignoring shell becomes the sleep itself, so the kill -9 on exit ends it (no orphan loop).
    const r = laufe(`sh -c 'trap "" TERM; exec sleep 60'`);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /still running after 15 seconds - nothing was copied or deleted/);
    assert.doesNotMatch(r.stdout, /Stopped/);
  });
});

describe("BIT-Atelier-Installer.cmd: same wait before the data step (rule 8)", () => {
  it("Get-Process loop up to 15 s, exit 1 when still running, no fixed Start-Sleep 2", () => {
    const stopp = CMD.slice(CMD.indexOf("# a) Stop a running BIT-Atelier"), CMD.indexOf("# b) The data folder"));
    assert.doesNotMatch(stopp, /Start-Sleep -Seconds 2/);
    assert.match(stopp, /while \(\(Get-Process -Id \$c\.OwningProcess -ErrorAction SilentlyContinue\) -and \$warten -lt 15\)/);
    assert.match(stopp, /still running after 15 seconds - nothing was copied or deleted[\s\S]*exit 1/);
  });
});

describe("bit-atelier.ps1: UTF-8 output of node", () => {
  it("sets [Console]::OutputEncoding before the node start calls; pure ASCII, CRLF", () => {
    assert.ok(PS1.every((b) => b < 0x80), "pure ASCII");
    const text = PS1.toString("ascii");
    assert.equal(/(^|[^\r])\n/.test(text), false, "CRLF only");
    const kodierung = text.indexOf("[Console]::OutputEncoding = [System.Text.Encoding]::UTF8");
    assert.ok(kodierung > 0, "encoding line missing");
    // The call sites (Join-Path …), not the file header that names the same scripts.
    assert.ok(kodierung < text.indexOf("Join-Path $App 'tools\\datei-oeffnen.mjs'") && kodierung < text.indexOf("Join-Path $App 'tools\\app-start.mjs'"));
  });

  it("Windows: with that line PowerShell keeps an umlaut of captured node output", (t) => {
    if (process.platform !== "win32") { t.skip("PowerShell on Windows"); return; }
    if (!gibt("powershell", ["-NoProfile", "-Command", "exit 0"])) { t.skip("powershell not available"); return; }
    const skript = 'try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }; $a = & node -e "process.stdout.write(String.fromCharCode(228))"; [int][char]("$a"[0])';
    const r = spawnSync("powershell", ["-NoProfile", "-Command", skript], { encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "228", `decoded as ${r.stdout.trim()} instead of 228 (ä)`);
  });
});
