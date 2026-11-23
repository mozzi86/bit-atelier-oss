// e2eTestdatenReset-10007.test.js — plan 100-07 (redesign after the data incident of 19.11.2026): the reset of the TEST
// database before a full E2E run (scripts/e2e-testdaten-reset.mjs) works ONLY in a folder that carries the marker file
// ".bit-testdaten" naming the folder's own real path; a missing folder is created only inside the (injected) temp folder.
//
// Every folder here is a throwaway folder below one mkdtemp folder of os.tmpdir(); the "home", "repository" and "temp"
// places are injected throwaway folders that imitate the real layout (a fake checkout with package.json, server/ and dummy
// .js files). The real home folder, the real repository and any real data folder are never named in a test.
// Checks: every refusal (unset BIT_DATA_DIR, symlinked folder, symlinked marker, marker naming another path, no marker,
// program files plus marker, server/ of a fake checkout plus marker, a folder inside a checkout, home / repo / root / temp and
// folders containing them, a missing folder outside temp), that a refusal deletes nothing, the running-server check, the
// creation of a new marked folder inside temp, and one real reset (old data gone, seed + test house there, only the fixed
// entries touched, a symlinked entry loses only its link).

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import {
  MARKER_NAME, portBelegt, testOrdnerPruefen, testdatenZuruecksetzen,
} from "../../scripts/e2e-testdaten-reset.mjs";
import { PROJEKT_NAME, TESTHAUS } from "../e2e/fixtures/testhaus.js";

const BASIS = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "e2e-reset-10007-")));
after(() => { try { fs.rmSync(BASIS, { recursive: true, force: true }); } catch { /* throwaway folder */ } });

/** Injected places: a fake home, a fake repository and a fake temp folder, all below BASIS. */
const HEIM = path.join(BASIS, "heim");
const REPO = path.join(BASIS, "repo");
const TEMP = path.join(BASIS, "temp");
for (const d of [HEIM, REPO, TEMP]) fs.mkdirSync(d, { recursive: true });
const UMGEBUNG = { heim: [HEIM], repos: [REPO], temp: TEMP };

/** @param {string|null} ordner @returns {ReturnType<typeof testOrdnerPruefen>} */
const pruefe = (ordner) => testOrdnerPruefen({ env: ordner == null ? {} : { BIT_DATA_DIR: ordner }, umgebung: UMGEBUNG });
/** @param {string} ordner @param {string} [inhalt] writes a marker (content: the folder itself unless given) */
const markieren = (ordner, inhalt = ordner) => fs.writeFileSync(path.join(ordner, MARKER_NAME), inhalt);
/** @param {string} ordner creates a folder with a marked, harmless data file */
function datenOrdner(ordner) {
  fs.mkdirSync(ordner, { recursive: true });
  fs.writeFileSync(path.join(ordner, "db.json"), JSON.stringify({ Altlast: [{ id: "x" }] }));
  return ordner;
}
/** @param {ReturnType<typeof testOrdnerPruefen>} r @param {RegExp} [muster] */
function abgelehnt(r, muster) {
  assert.equal(r.ok, false, JSON.stringify(r));
  if (muster && !r.ok) assert.match(r.grund, muster);
}

/** A fake source checkout: package.json, server/ with program files and a "real" db.json, .git. */
const KLON = path.join(BASIS, "klon");
fs.mkdirSync(path.join(KLON, "server", "blobs"), { recursive: true });
fs.mkdirSync(path.join(KLON, ".git"), { recursive: true });
fs.writeFileSync(path.join(KLON, "package.json"), "{}");
fs.writeFileSync(path.join(KLON, "server", "index.js"), "// dummy");
fs.writeFileSync(path.join(KLON, "server", "seed.js"), "// dummy");
fs.writeFileSync(path.join(KLON, "server", "db.json"), "{\"Echt\":[]}");

describe("100-07 guard — refusals", () => {
  it("refuses without BIT_DATA_DIR (the server default is the checkout's server/ folder)", () => {
    abgelehnt(pruefe(null), /BIT_DATA_DIR/);
    abgelehnt(pruefe("   "), /BIT_DATA_DIR/);
  });

  it("refuses an existing folder without marker and says how to write one", () => {
    const o = datenOrdner(path.join(BASIS, "ohne-marker"));
    const r = pruefe(o);
    abgelehnt(r, new RegExp(MARKER_NAME.replace(".", "\\.")));
    assert.ok(!r.ok && r.grund.includes(`printf '%s' '${o}'`), "German instruction with the exact command");
  });

  it("refuses an existing folder without marker also inside temp", () => {
    abgelehnt(pruefe(datenOrdner(path.join(TEMP, "alt-ohne-marker"))), /Markierung/);
  });

  it("refuses a marker that names another path", () => {
    const o = datenOrdner(path.join(BASIS, "falscher-marker"));
    markieren(o, path.join(BASIS, "anderswo"));
    abgelehnt(pruefe(o), /nennt/);
    markieren(o, "");
    abgelehnt(pruefe(o), /keinen Pfad/);
  });

  it("refuses a marker that is a symlink to a valid marker elsewhere", () => {
    const echt = datenOrdner(path.join(BASIS, "echt-markiert"));
    markieren(echt);
    const o = datenOrdner(path.join(BASIS, "link-marker"));
    // the linked marker names "echt"; one that names o itself must be refused as well
    fs.symlinkSync(path.join(echt, MARKER_NAME), path.join(o, MARKER_NAME));
    abgelehnt(pruefe(o), /gewöhnliche Datei/);
    const fremd = path.join(BASIS, "fremd-marker.txt");
    fs.writeFileSync(fremd, o);
    const o2 = datenOrdner(path.join(BASIS, "link-marker-2"));
    fs.symlinkSync(fremd, path.join(o2, MARKER_NAME));
    abgelehnt(pruefe(o2), /gewöhnliche Datei/);
  });

  it("refuses BIT_DATA_DIR that is a symlink, also into a validly marked folder", () => {
    const ziel = datenOrdner(path.join(BASIS, "link-ziel"));
    markieren(ziel);
    const link = path.join(BASIS, "link-auf-ordner");
    fs.symlinkSync(ziel, link);
    abgelehnt(pruefe(link), /symbolischer Link/);
    // a marker naming the link path (the path reached through the symlink) is no valid marker for the real folder either
    const ziel2 = datenOrdner(path.join(BASIS, "link-ziel-2"));
    const link2 = path.join(BASIS, "link-auf-ordner-2");
    fs.symlinkSync(ziel2, link2);
    markieren(ziel2, link2);
    abgelehnt(pruefe(ziel2), /nennt/);
  });

  it("refuses a folder with program files even when it carries a valid marker", () => {
    const o = datenOrdner(path.join(BASIS, "mit-programm"));
    markieren(o);
    for (const datei of ["index.js", "x.mjs", "y.cjs"]) {
      fs.writeFileSync(path.join(o, datei), "");
      abgelehnt(pruefe(o), /Programmdatei/);
      fs.rmSync(path.join(o, datei));
    }
    fs.mkdirSync(path.join(o, "blobs", "tief"), { recursive: true });
    fs.writeFileSync(path.join(o, "blobs", "tief", "versteckt.js"), "");
    abgelehnt(pruefe(o), /Programmdatei/);
    fs.rmSync(path.join(o, "blobs"), { recursive: true });
    fs.writeFileSync(path.join(o, "package.json"), "{}");
    abgelehnt(pruefe(o), /Projektdatei/);
  });

  it("refuses the server/ folder of a fake checkout, its root and folders inside it, also with a marker", () => {
    const server = path.join(KLON, "server");
    markieren(server);
    abgelehnt(pruefe(server));
    fs.rmSync(path.join(server, MARKER_NAME));
    markieren(KLON);
    abgelehnt(pruefe(KLON));
    fs.rmSync(path.join(KLON, MARKER_NAME));
    const innen = datenOrdner(path.join(KLON, "testdaten"));
    markieren(innen);
    abgelehnt(pruefe(innen), /Quellstand/);
    // a server/ beside a package.json without any program file in it
    const nackt = path.join(BASIS, "nackt");
    fs.mkdirSync(path.join(nackt, "server"), { recursive: true });
    fs.writeFileSync(path.join(nackt, "package.json"), "{}");
    markieren(path.join(nackt, "server"));
    // the ancestor rule (package.json + server/ = a source checkout) fires before the server/-name rule, so the reason
    // names the checkout; what counts is the refusal.
    abgelehnt(pruefe(path.join(nackt, "server")), /Quellstand/);
    assert.equal(fs.readFileSync(path.join(server, "db.json"), "utf8"), "{\"Echt\":[]}", "the fake real data is untouched");
  });

  it("refuses a folder that contains a checkout, even when marked", () => {
    const huelle = path.join(BASIS, "huelle");
    fs.mkdirSync(path.join(huelle, "projekte", "app", "server"), { recursive: true });
    fs.writeFileSync(path.join(huelle, "projekte", "app", "package.json"), "{}");
    markieren(huelle);
    abgelehnt(pruefe(huelle), /Projektdatei|server\//);
  });

  it("refuses home, repository and temp - and any folder containing them or inside the repository - also when marked", () => {
    for (const o of [HEIM, REPO, TEMP]) {
      markieren(o);
      abgelehnt(pruefe(o), /nie zurückgesetzt/);
      fs.rmSync(path.join(o, MARKER_NAME));
    }
    markieren(BASIS);
    abgelehnt(pruefe(BASIS), /enthält/);
    fs.rmSync(path.join(BASIS, MARKER_NAME));
    // The file-system root itself is not named here (only throwaway folders in tests); it is refused by the same
    // "is or contains" rule as BASIS above and by an explicit equality check in the guard.
    const imRepo = datenOrdner(path.join(REPO, "daten"));
    markieren(imRepo);
    abgelehnt(pruefe(imRepo), /Quellstand/);
  });

  it("creates nothing outside temp: a missing folder elsewhere is refused", () => {
    const fehlt = path.join(BASIS, "gibt-es-nicht", "daten");
    abgelehnt(pruefe(fehlt), /Temp-Ordner/);
    assert.throws(() => testdatenZuruecksetzen({ env: { BIT_DATA_DIR: fehlt }, umgebung: UMGEBUNG }), /abgelehnt/);
    assert.equal(fs.existsSync(path.join(BASIS, "gibt-es-nicht")), false);
  });

  it("a refused reset deletes nothing", () => {
    const o = datenOrdner(path.join(BASIS, "bleibt"));
    markieren(o, "/irgendwo/anders");
    assert.throws(() => testdatenZuruecksetzen({ env: { BIT_DATA_DIR: o }, umgebung: UMGEBUNG }), /abgelehnt/);
    assert.ok(fs.existsSync(path.join(o, "db.json")));
  });
});

describe("100-07 guard — what passes", () => {
  it("a folder whose marker names its own real path", () => {
    const o = datenOrdner(path.join(BASIS, "gut-markiert"));
    markieren(o);
    const r = pruefe(o);
    assert.deepEqual(r, { ok: true, ordner: o, neu: false });
    markieren(o, `${o}\n`);
    assert.equal(pruefe(o).ok, true, "a trailing newline (echo) is fine");
  });

  it("a missing folder inside temp (created and marked by the reset)", () => {
    const r = pruefe(path.join(TEMP, "neu", "daten"));
    assert.deepEqual(r, { ok: true, ordner: path.join(TEMP, "neu", "daten"), neu: true });
  });
});

describe("100-07 reset", () => {
  it("portBelegt sees a listening port", async () => {
    const s = net.createServer();
    await new Promise((r) => s.listen(0, "127.0.0.1", () => r(undefined)));
    const port = /** @type {net.AddressInfo} */ (s.address()).port;
    assert.equal(await portBelegt(port), true);
    await new Promise((r) => s.close(() => r(undefined)));
    assert.equal(await portBelegt(port), false);
  });

  it("creates a new folder inside temp, marks it and seeds it", () => {
    const ordner = path.join(TEMP, "frisch");
    const b = testdatenZuruecksetzen({ env: { BIT_DATA_DIR: ordner }, umgebung: UMGEBUNG });
    assert.equal(b.ordner, ordner);
    assert.equal(fs.readFileSync(path.join(ordner, MARKER_NAME), "utf8"), ordner);
    assert.ok(fs.existsSync(path.join(ordner, "db.json")));
    // the folder now passes as an existing marked folder (a second run works)
    assert.deepEqual(pruefe(ordner), { ok: true, ordner, neu: false });
  });

  it("replaces the old test data by seed + test house and touches only the fixed entries", () => {
    const ordner = datenOrdner(path.join(BASIS, "e2e-daten"));
    markieren(ordner);
    fs.mkdirSync(path.join(ordner, "blobs"), { recursive: true });
    fs.writeFileSync(path.join(ordner, "blobs", "alt.bin"), "{}");
    fs.writeFileSync(path.join(ordner, "notiz.txt"), "bleibt");
    // a symlinked entry: only the link goes, never what it points to
    const fremd = path.join(BASIS, "fremd-personal-blobs");
    fs.mkdirSync(fremd, { recursive: true });
    fs.writeFileSync(path.join(fremd, "wichtig.bin"), "bleibt");
    fs.symlinkSync(fremd, path.join(ordner, "personal-blobs"));
    const daneben = path.join(BASIS, "daneben.json");
    fs.writeFileSync(daneben, "bleibt");

    const bericht = testdatenZuruecksetzen({ env: { BIT_DATA_DIR: ordner }, umgebung: UMGEBUNG });
    const db = JSON.parse(fs.readFileSync(path.join(ordner, "db.json"), "utf8"));
    assert.equal(db.Altlast, undefined, "old data gone");
    assert.ok(Array.isArray(db.Project) && db.Project.length > 1, "seed projects there");
    const haus = db.Project.filter((p) => p.name === PROJEKT_NAME);
    assert.equal(haus.length, 1, "exactly one test house project");
    const modell = (db.BimModel || []).filter((m) => m.project_id === haus[0].id);
    assert.equal(modell.length, 1);
    assert.deepEqual(modell[0].footprintM, TESTHAUS.footprintM);
    assert.equal(modell[0].storeys, TESTHAUS.storeys);
    assert.equal(fs.existsSync(path.join(ordner, "blobs", "alt.bin")), false);
    assert.equal(fs.existsSync(path.join(ordner, "personal-blobs")), false, "the link is gone");
    assert.equal(fs.readFileSync(path.join(fremd, "wichtig.bin"), "utf8"), "bleibt", "the link target is untouched");
    assert.equal(fs.readFileSync(path.join(ordner, "notiz.txt"), "utf8"), "bleibt");
    assert.equal(fs.readFileSync(daneben, "utf8"), "bleibt");
    assert.equal(fs.readFileSync(path.join(ordner, MARKER_NAME), "utf8"), ordner, "marker kept");
    assert.equal(bericht.testhausProjekt, haus[0].id);
    assert.ok(bericht.entfernt.includes("db.json") && bericht.entfernt.includes("personal-blobs"));
  });
});
