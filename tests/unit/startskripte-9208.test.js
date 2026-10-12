// Unit tests for plan 92-08: (1) the start scripts tell a network failure of `npm ci` apart (npm ping) and
// explain proxy / company registry / copying a complete folder in English and German, and remove a
// half-installed node_modules; start-windows.cmd stays ASCII + CRLF, start.sh ASCII + LF and passes sh -n.
// (2) The public export carries .github/dependabot.yml (npm + github-actions, weekly, grouped) and the release
// workflow audits the runtime packages as a gate.
//
// The functional run of start.sh uses a fake `npm` first on PATH inside a temp app folder that has its own
// package.json (so a real npm could never walk up into another project). It runs only off Windows (the CI
// runner): there PATH lookup is plain POSIX; a guard skips the case when the fake is not the npm found.
// On Windows both scripts were checked by hand with the same fake (92-08-SUMMARY.md).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const WURZEL = process.cwd();
/** Private repo: oss/<path>; public export: the overlay lies at the root. */
const overlay = (...teile) => {
  const privat = path.join(WURZEL, "oss", ...teile);
  return fs.existsSync(privat) ? privat : path.join(WURZEL, ...teile);
};

describe("start scripts (92-08)", () => {
  it("start-windows.cmd: ASCII, CRLF, npm failures go through the network check", () => {
    const roh = fs.readFileSync(path.join(WURZEL, "start-windows.cmd"));
    assert.ok(roh.every((b) => b < 0x80), "pure ASCII");
    const text = roh.toString("ascii");
    assert.equal(/(^|[^\r])\n/.test(text), false, "CRLF only");
    assert.equal((text.match(/if errorlevel 1 goto :npm_fehler/g) || []).length, 2, "both npm ci calls");
    assert.match(text, /:npm_fehler\r\n[\s\S]*rd \/s \/q "node_modules"[\s\S]*call npm ping --fetch-timeout=15000 --fetch-retries=0/);
    assert.match(text, /npm config set proxy[\s\S]*npm config set https-proxy[\s\S]*npm config set registry[\s\S]*including node_modules[\s\S]*\(Deutsch:/);
  });

  it("start.sh: ASCII, LF, sh -n, npm failures go through the network check", (t) => {
    const text = fs.readFileSync(path.join(WURZEL, "start.sh"), "ascii");
    assert.equal(text.includes("\r"), false);
    assert.equal((text.match(/\|\| npm_fehler/g) || []).length, 2);
    assert.match(text, /npm ping --fetch-timeout=15000 --fetch-retries=0/);
    if (spawnSync("sh", ["-c", "exit 0"]).error) { t.skip("sh not available"); return; }
    assert.equal(spawnSync("sh", ["-n", path.join(WURZEL, "start.sh")]).status, 0);
  });

  it("start.sh with an unreachable registry prints the explanation and leaves no node_modules", (t) => {
    if (process.platform === "win32") { t.skip("checked by hand on Windows (PATH lookup of Git Bash)"); return; }
    if (spawnSync("sh", ["-c", "exit 0"]).error) { t.skip("sh not available"); return; }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-start-"));
    const app = path.join(tmp, "app"), bin = path.join(tmp, "bin");
    fs.mkdirSync(path.join(app, "dist"), { recursive: true }); fs.mkdirSync(bin);
    fs.copyFileSync(path.join(WURZEL, "start.sh"), path.join(app, "start.sh"));
    fs.writeFileSync(path.join(app, "dist", "index.html"), "x");
    fs.writeFileSync(path.join(app, "package.json"), "{\"name\":\"sandbox\",\"private\":true}");
    fs.writeFileSync(path.join(bin, "npm"), "#!/bin/sh\necho FAKE-NPM \"$@\" >&2\ncase \"$1\" in ci) mkdir -p node_modules/x; exit 1;; ping) exit ${FAKE_PING:-1};; config) echo https://registry.example/; exit 0;; esac\nexit 0\n", { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, BIT_KEIN_BROWSER: "1" };
    const welches = spawnSync("sh", ["-c", "command -v npm"], { env, encoding: "utf8" }).stdout.trim();
    if (welches !== path.join(bin, "npm")) { t.skip(`fake npm not first on PATH (${welches})`); return; }
    const netz = spawnSync("sh", ["./start.sh"], { cwd: app, env, encoding: "utf8", timeout: 30000 });
    assert.equal(netz.status, 1);
    assert.match(netz.stderr, /FAKE-NPM ci --omit=dev/);
    assert.match(netz.stdout, /could not be downloaded: https:\/\/registry\.example\/[\s\S]*npm config set https-proxy[\s\S]*\(Deutsch:/);
    assert.equal(fs.existsSync(path.join(app, "node_modules")), false);
    const anders = spawnSync("sh", ["./start.sh"], { cwd: app, env: { ...env, FAKE_PING: "0" }, encoding: "utf8", timeout: 30000 });
    assert.equal(anders.status, 1);
    assert.match(anders.stdout, /Installing failed - see the messages above/);
    assert.doesNotMatch(anders.stdout, /could not be downloaded/);
  });
});

describe("dependency watch (92-08)", () => {
  it("dependabot.yml: npm + github-actions, weekly, grouped minor/patch", () => {
    const yml = fs.readFileSync(overlay(".github", "dependabot.yml"), "utf8");
    assert.match(yml, /^version: 2$/m);
    assert.match(yml, /package-ecosystem: npm[\s\S]*interval: weekly[\s\S]*groups:[\s\S]*update-types: \[minor, patch\]/);
    assert.match(yml, /package-ecosystem: github-actions[\s\S]*interval: weekly[\s\S]*groups:/);
  });

  it("the release workflow audits runtime packages as a gate; CI reports without blocking", () => {
    const release = fs.readFileSync(overlay(".github", "workflows", "release.yml"), "utf8");
    const schritt = /- name: Audit runtime packages\n\s+run: npm audit --omit=dev --audit-level=high\n/.exec(release);
    assert.ok(schritt, "audit step in release.yml");
    assert.doesNotMatch(release.slice(schritt.index, schritt.index + 200), /continue-on-error/);
    assert.ok(schritt.index < release.indexOf("- name: Publish the release"));
    const ci = fs.readFileSync(overlay(".github", "workflows", "ci.yml"), "utf8");
    assert.match(ci, /npm audit --omit=dev --audit-level=high\n\s+continue-on-error: true/);
  });
});
