// 105-21 (register no. 235): THIRD-PARTY-LICENSES.md is a promise to users — above all the LGPL source offer for
// planegcs. Until 22.10.2026 it named planegcs 1.3.0 while vendor/ held the 1.2.0 tarball, and web-ifc/dompurify
// were listed with outdated versions. This test keeps the file, the lockfile and the archived source in step.
//
// In: THIRD-PARTY-LICENSES.md, package-lock.json, vendor/. Out: assertions only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const liste = fs.readFileSync("THIRD-PARTY-LICENSES.md", "utf8");
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));

/** Sections "## <package> — <licence>" with an exact "**Version:** x.y.z". */
function eintraege() {
  const out = [];
  for (const block of liste.split(/^## /m).slice(1)) {
    const name = block.split(/\s+—\s+|\n/)[0].trim();
    const v = /\*\*Version:\*\*\s+(\d+\.\d+\.\d+)/.exec(block);
    if (v) out.push({ name, version: v[1] });
  }
  return out;
}

test("jede exakt genannte Version in THIRD-PARTY-LICENSES.md = installierte Version laut Lockfile", () => {
  const e = eintraege();
  assert.ok(e.length >= 3, `zu wenige Einträge gefunden: ${e.map((x) => x.name).join(", ")}`);
  for (const { name, version } of e) {
    const installiert = lock.packages?.[`node_modules/${name}`]?.version;
    assert.ok(installiert, `${name} steht in der Liste, aber nicht im Lockfile`);
    assert.equal(version, installiert, `${name}: Liste nennt ${version}, installiert ist ${installiert}`);
  }
});

test("LGPL-Quellenarchiv in vendor/ = ausgelieferte planegcs-Version, kein veraltetes daneben", () => {
  const installiert = lock.packages["node_modules/@salusoft89/planegcs"].version;
  const archive = fs.readdirSync("vendor").filter((f) => /^salusoft89-planegcs-.*\.tgz$/.test(f));
  assert.deepEqual(archive, [`salusoft89-planegcs-${installiert}.tgz`]);
  assert.ok(liste.includes(`vendor/salusoft89-planegcs-${installiert}.tgz`), "die Liste nennt das Archiv der ausgelieferten Version");
  assert.ok(fs.statSync(path.join("vendor", archive[0])).size > 100_000, "Archiv ist kein Platzhalter");
});
