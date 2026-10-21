// Unit tests for plan 104-10, part 2: the path rule (@core/lib/pfadRichtlinie.js) where it is APPLIED —
// the .bitproj launcher route and its stored source link (server/dateiOeffnenRouter.js), the launcher
// argument (tools/datei-oeffnen.mjs), "Ordner öffnen" (server/systemRouter.js), the backup target
// (server/sicherung.js), the IFC test route (server/ifcTestDatei.js), the desktop shell bridge
// (src/client/dateiHuelle.js) and the document window (src/lib/dokumentAnzeige.js).
// Windows and POSIX notation each; nothing here touches a network path or a device.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

import { createDb } from "../../packages/nova-core/server/db.js";
import { dateiOeffnenRouter, lokalerPfad, pfadPruefen, QUELLE_DATEI } from "../../server/dateiOeffnenRouter.js";
import { dateiAusArgument } from "../../tools/datei-oeffnen.mjs";
import { ordnerOeffnen } from "../../server/systemRouter.js";
import { sicherungAnlegen } from "../../server/sicherung.js";
import { ifcTestPfad } from "../../server/ifcTestDatei.js";
import { huellenPfad } from "@/client/dateiHuelle.js";
import { inhaltImFensterZeigen, BELEG_TYPEN } from "@/lib/dokumentAnzeige.js";
import { PFAD_MELDUNGEN, PFAD_GRUND } from "@core/lib/pfadRichtlinie.js";

const M = PFAD_MELDUNGEN;
const G = PFAD_GRUND;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-10410-"));
after(() => fs.rmSync(temp, { recursive: true, force: true }));

/**
 * The error a call throws, or null.
 * @param {() => unknown} fn
 * @returns {any}
 */
function fehler(fn) {
  try { fn(); return null; } catch (e) { return e; }
}

describe("dateiOeffnenRouter — launcher paths under the path rule (104-10)", () => {
  it("lokalerPfad: Windows notation", () => {
    assert.equal(lokalerPfad("C:/Projekte/Musterhaus.bitproj", "win32"), "C:\\Projekte\\Musterhaus.bitproj");
    assert.equal(lokalerPfad("file:///C:/Projekte/Plan%20A.bitproj", "win32"), "C:\\Projekte\\Plan A.bitproj");
    const faelle = [
      ["\\\\server\\share\\x.bitproj", M[G.UNC]],
      ["//server/share/x.bitproj", M[G.UNC]],
      ["\\\\?\\C:\\x.bitproj", M[G.GERAET]],
      ["\\\\.\\pipe\\x.bitproj", M[G.GERAET]],
      ["file://server/share/x.bitproj", M[G.FILE_HOST]],
      ["https://example.invalid/x.bitproj", M[G.URL_SCHEMA]],
      ["smb://server/share/x.bitproj", M[G.URL_SCHEMA]],
      ["C:x.bitproj", M[G.LAUFWERK_RELATIV]],
      ["\\Projekte\\x.bitproj", M[G.OHNE_LAUFWERK]],
      ["C:\\a\\..\\x.bitproj", M[G.ZURUECK]],
      ["C:\\CON\\x.bitproj", M[G.RESERVIERT]],
      ["C:\\a\u0000.bitproj", M[G.STEUERZEICHEN]],
      ["x.bitproj", M[G.RELATIV]],
    ];
    for (const [p, meldung] of faelle) {
      const e = fehler(() => lokalerPfad(p, "win32"));
      assert.ok(e, `${p} must be refused`);
      assert.equal(e.status, 400, p);
      assert.equal(e.message, meldung, p);
    }
  });

  it("lokalerPfad: POSIX notation", () => {
    assert.equal(lokalerPfad("/home/nutzer/Projekte/a.bitproj", "posix"), "/home/nutzer/Projekte/a.bitproj");
    assert.equal(lokalerPfad("file:///home/nutzer/a.bitproj", "posix"), "/home/nutzer/a.bitproj");
    for (const [p, meldung] of [
      ["//server/share/x.bitproj", M[G.UNC]],
      ["/dev/zero", M[G.GERAET]],
      ["/proc/self/environ", M[G.GERAET]],
      ["/home/user/../../etc/x.bitproj", M[G.ZURUECK]],
      ["file://server/x.bitproj", M[G.FILE_HOST]],
      ["javascript:alert(1)", M[G.URL_SCHEMA]],
      ["a/x.bitproj", M[G.RELATIV]],
    ]) {
      const e = fehler(() => lokalerPfad(p, "posix"));
      assert.equal(e?.message, meldung, p);
    }
  });

  it("pfadPruefen refuses a share before the disk is asked, accepts a real local file", async () => {
    await assert.rejects(pfadPruefen("\\\\server\\share\\x.bitproj"), (e) => /** @type {any} */ (e).status === 400 && /** @type {any} */ (e).message === M[G.UNC]);
    await assert.rejects(pfadPruefen("//server/share/x.bitproj"), (e) => /** @type {any} */ (e).message === M[G.UNC]);
    const datei = path.join(temp, "Musterhaus.bitproj");
    fs.writeFileSync(datei, "x");
    assert.equal(await pfadPruefen(datei), await fs.promises.realpath(datei), "same resolver as the route");
  });

  it("a stored source link on a share is shown, never looked up, and never written back to", async () => {
    const daten = path.join(temp, "daten");
    fs.mkdirSync(daten, { recursive: true });
    const db = createDb(path.join(daten, "db.json"));
    fs.writeFileSync(path.join(daten, QUELLE_DATEI), JSON.stringify({
      pfad: "\\\\server\\share\\Musterhaus.bitproj", name: "Musterhaus.bitproj", projektname: "Musterhaus",
      importiertAm: "2026-10-21T08:00:00.000Z", groesse: 1, mtimeMs: 1, sha256: "0",
    }));
    const app = express();
    app.use(express.json());
    app.use("/api", dateiOeffnenRouter({ db, lokalGebunden: true, port: 4711, datenOrdnerFn: () => daten }));
    const srv = app.listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    try {
      const basis = `http://127.0.0.1:${/** @type {any} */ (srv.address()).port}/api`;
      const q = await (await fetch(`${basis}/datei/quelle`, { headers: { "Sec-Fetch-Site": "same-origin" } })).json();
      assert.equal(q.quelle?.pfad, "\\\\server\\share\\Musterhaus.bitproj");
      assert.equal(q.vorhanden, false);
      const r = await fetch(`${basis}/datei/zurueckschreiben`, {
        method: "POST", headers: { Origin: "http://localhost:4711", "Content-Type": "application/json" }, body: "{}",
      });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error, M[G.UNC]);
    } finally {
      srv.close();
    }
  });
});

describe("tools/datei-oeffnen.mjs — the launcher argument (104-10)", () => {
  const aufloesenWin = (/** @type {string} */ p) => path.win32.resolve("C:\\Arbeit", p);
  const aufloesenPosix = (/** @type {string} */ p) => path.posix.resolve("/home/nutzer", p);

  it("a plain relative name is resolved against the working folder, then checked", () => {
    assert.deepEqual(dateiAusArgument("Plan.bitproj", { plattform: "win32", aufloesen: aufloesenWin }), { ok: true, pfad: "C:\\Arbeit\\Plan.bitproj" });
    assert.deepEqual(dateiAusArgument("Plan.bitproj", { plattform: "posix", aufloesen: aufloesenPosix }), { ok: true, pfad: "/home/nutzer/Plan.bitproj" });
    assert.equal(dateiAusArgument("../Plan.bitproj", { plattform: "posix", aufloesen: aufloesenPosix }).ok, true, "resolved, no .. left");
  });

  it("drive letters, schemes and leading separators keep their own reason", () => {
    const w = { plattform: /** @type {const} */ ("win32"), aufloesen: aufloesenWin };
    assert.equal(dateiAusArgument("C:Plan.bitproj", w).ok === false && dateiAusArgument("C:Plan.bitproj", w).grund, G.LAUFWERK_RELATIV);
    assert.equal(/** @type {any} */ (dateiAusArgument("\\\\server\\share\\Plan.bitproj", w)).grund, G.UNC);
    assert.equal(/** @type {any} */ (dateiAusArgument("file://server/share/Plan.bitproj", w)).grund, G.FILE_HOST);
    assert.equal(/** @type {any} */ (dateiAusArgument("\\\\.\\COM1", w)).grund, G.GERAET);
    assert.equal(/** @type {any} */ (dateiAusArgument("NUL.bitproj", w)).grund, G.RESERVIERT, "a relative device name is resolved and still refused");
    assert.deepEqual(dateiAusArgument("file:///C:/Projekte/Plan.bitproj", w), { ok: true, pfad: "C:\\Projekte\\Plan.bitproj" });
    const p = { plattform: /** @type {const} */ ("posix"), aufloesen: aufloesenPosix };
    assert.equal(/** @type {any} */ (dateiAusArgument("//server/share/Plan.bitproj", p)).grund, G.UNC);
    assert.equal(/** @type {any} */ (dateiAusArgument("/dev/stdin", p)).grund, G.GERAET);
    assert.equal(/** @type {any} */ (dateiAusArgument("", p)).grund, G.LEER);
  });
});

describe("systemRouter.ordnerOeffnen — nothing but a folder reaches the opener (104-10)", () => {
  it("refuses URLs, switches, device and relative paths before any process starts", async () => {
    for (const [ordner, plattform, meldung] of [
      ["https://example.invalid/", "win32", M[G.URL_SCHEMA]],
      ["javascript:alert(1)", "linux", M[G.URL_SCHEMA]],
      ["/select,C:\\x", "win32", M[G.OHNE_LAUFWERK]],
      ["--help", "linux", M[G.RELATIV]],
      ["\\\\.\\COM1", "win32", M[G.GERAET]],
      ["C:\\daten\\NUL", "win32", M[G.RESERVIERT]],
      ["/proc/1", "linux", M[G.GERAET]],
      ["/a/../b", "darwin", M[G.ZURUECK]],
    ]) {
      await assert.rejects(ordnerOeffnen(ordner, /** @type {NodeJS.Platform} */ (plattform)), { message: meldung }, ordner);
    }
  });
});

describe("sicherung — the backup target under the path rule (104-10)", () => {
  it("control characters and (on Windows) device names are refused with the reason", () => {
    const daten = path.join(temp, "daten-sicherung");
    fs.mkdirSync(daten, { recursive: true });
    assert.throws(() => sicherungAnlegen({ datenOrdner: daten, zielOrdner: path.join(temp, "ziel\u0007") }),
      { message: `Sicherungsordner ungültig: ${M[G.STEUERZEICHEN]}` });
    if (process.platform === "win32") {
      assert.throws(() => sicherungAnlegen({ datenOrdner: daten, zielOrdner: path.join(temp, "NUL") }),
        { message: `Sicherungsordner ungültig: ${M[G.RESERVIERT]}` });
    }
  });
});

describe("ifcTestPfad — the IFC test route (104-10)", () => {
  it("Windows: a name stays a plain file name inside IFC_DIR; a share as IFC_DIR is configuration", () => {
    const o = { ifcDir: "C:\\Modelle", plattform: /** @type {const} */ ("win32") };
    assert.deepEqual(ifcTestPfad({ ...o, name: "Haus.ifc" }), { ok: true, pfad: "C:\\Modelle\\Haus.ifc" });
    assert.deepEqual(ifcTestPfad({ ...o, name: "Haus.IFC" }), { ok: true, pfad: "C:\\Modelle\\Haus.IFC" }, "same as the listing");
    assert.deepEqual(ifcTestPfad({ ifcDir: "\\\\nas\\modelle", plattform: "win32", name: "Haus.ifc" }), { ok: true, pfad: "\\\\nas\\modelle\\Haus.ifc" });
    for (const name of ["..\\x.ifc", "a/x.ifc", "a\\x.ifc", "C:\\x.ifc", "\\\\server\\x.ifc"]) {
      assert.equal(/** @type {any} */ (ifcTestPfad({ ...o, name })).status, 400, name);
    }
    assert.deepEqual(ifcTestPfad({ ...o, name: "CON.ifc" }), { ok: false, status: 400, error: M[G.RESERVIERT] });
    assert.deepEqual(ifcTestPfad({ ...o, name: "x\u0001.ifc" }), { ok: false, status: 400, error: M[G.STEUERZEICHEN] });
    assert.equal(/** @type {any} */ (ifcTestPfad({ ...o, name: "x.txt" })).status, 404);
    assert.equal(/** @type {any} */ (ifcTestPfad({ plattform: "win32", name: "x.ifc" })).status, 404, "no folder");
    assert.deepEqual(ifcTestPfad({ plattform: "win32", testDatei: "\\\\.\\C:\\x.ifc" }), { ok: false, status: 400, error: M[G.GERAET] });
  });

  it("POSIX: same rule, IFC_TEST_FILE alone, its folder for names", () => {
    const o = { testDatei: "/srv/modelle/Referenz.ifc", plattform: /** @type {const} */ ("posix") };
    assert.deepEqual(ifcTestPfad(o), { ok: true, pfad: "/srv/modelle/Referenz.ifc" });
    assert.deepEqual(ifcTestPfad({ ...o, name: "Haus.ifc" }), { ok: true, pfad: "/srv/modelle/Haus.ifc" });
    assert.equal(/** @type {any} */ (ifcTestPfad({ ...o, name: "../x.ifc" })).status, 400);
    assert.equal(/** @type {any} */ (ifcTestPfad({ ...o, name: ".." })).status, 400);
    assert.deepEqual(ifcTestPfad({ plattform: "posix", testDatei: "/dev/x.ifc" }), { ok: false, status: 400, error: M[G.GERAET] });
  });
});

describe("dateiHuelle.huellenPfad — paths handed to the desktop shell (104-10)", () => {
  it("passes local drive and POSIX paths unchanged, refuses shares, devices and URLs", () => {
    assert.equal(huellenPfad("C:\\Projekte\\x.bitproj"), "C:\\Projekte\\x.bitproj");
    assert.equal(huellenPfad("/home/user/x.bitproj"), "/home/user/x.bitproj");
    assert.throws(() => huellenPfad("\\\\server\\share\\x.bitproj"), { message: M[G.UNC] });
    assert.throws(() => huellenPfad("\\\\?\\C:\\x.bitproj"), { message: M[G.GERAET] });
    assert.throws(() => huellenPfad("http://example.invalid/x.bitproj"), { message: M[G.URL_SCHEMA] });
    assert.throws(() => huellenPfad(null), { message: M[G.LEER] });
  });
});

/**
 * A minimal stand-in for the about:blank window Reports/BelegAnhang open — just the DOM calls
 * dokumentAnzeige.js makes, so the test can see WHAT was built.
 * @returns {{fenster: any, kinder: any[]}}
 */
function fensterAttrappe() {
  /** @type {any[]} */
  const kinder = [];
  const element = (/** @type {string} */ tag) => ({ tag, style: {}, attribute: {}, textContent: "", setAttribute(k, v) { this.attribute[k] = v; } });
  const document = {
    title: "",
    createElement: element,
    body: { style: {}, replaceChildren() { kinder.length = 0; }, appendChild(k) { kinder.push(k); } },
  };
  return { fenster: { document }, kinder };
}

describe("dokumentAnzeige — stored document content in a new window (104-10)", () => {
  const t = (/** @type {string} */ k) => k;
  const PDF = "data:application/pdf;base64,JVBERi0=";
  const PNG = "data:image/png;base64,iVBORw0KGgo=";

  it("a PDF becomes an iframe, an image an img; the name is only ever text or an attribute", () => {
    let a = fensterAttrappe();
    assert.equal(inhaltImFensterZeigen(a.fenster, PDF, { name: '"><script>alert(1)</script>', t }), true);
    assert.equal(a.kinder[0].tag, "iframe");
    assert.equal(a.kinder[0].src, PDF);
    assert.equal(a.kinder[0].title, '"><script>alert(1)</script>');
    assert.equal(a.fenster.document.title, '"><script>alert(1)</script>');
    a = fensterAttrappe();
    inhaltImFensterZeigen(a.fenster, PNG, { name: "Foto.png", t });
    assert.equal(a.kinder[0].tag, "img");
    assert.equal(a.kinder[0].alt, "Foto.png");
  });

  it("scripts, web addresses, paths, HTML and SVG are refused with the plain-text reason", () => {
    for (const [wert, meldung] of [
      ["javascript:alert(1)", M[G.INHALT_VERWEIS]],
      ["https://example.invalid/x.pdf", M[G.INHALT_VERWEIS]],
      ["file:///C:/x.pdf", M[G.INHALT_VERWEIS]],
      ["C:\\Projekte\\x.pdf", M[G.INHALT_VERWEIS]],
      ["\\\\server\\share\\x.pdf", M[G.INHALT_VERWEIS]],
      ["data:text/html,<script>alert(1)</script>", M[G.INHALT_TYP]],
      ["data:image/svg+xml,<svg onload=alert(1)>", M[G.INHALT_TYP]],
      [null, M[G.LEER]],
    ]) {
      const a = fensterAttrappe();
      assert.equal(inhaltImFensterZeigen(a.fenster, wert, { name: "x", t }), false, String(wert));
      assert.equal(a.kinder.length, 1);
      assert.equal(a.kinder[0].tag, "p");
      assert.equal(a.kinder[0].textContent, meldung, String(wert));
      assert.equal(a.kinder[0].attribute.role, "alert");
    }
  });

  it("receipts may also offer XML as a download link — only when the caller allows it", () => {
    const XML = "data:application/xml;base64,PHg+PC94Pg==";
    let a = fensterAttrappe();
    assert.equal(inhaltImFensterZeigen(a.fenster, XML, { name: "Rechnung.xml", t, typen: BELEG_TYPEN }), true);
    assert.equal(a.kinder[0].tag, "a");
    assert.equal(a.kinder[0].href, XML);
    assert.equal(a.kinder[0].download, "Rechnung.xml");
    a = fensterAttrappe();
    assert.equal(inhaltImFensterZeigen(a.fenster, XML, { name: "Rechnung.xml", t }), false, "documents: PDF and images only");
  });

  it("Reports documents: SVG/TIFF are offered as a download with the reason as a note, references stay refused", () => {
    for (const wert of ["data:image/svg+xml,<svg onload=alert(1)>", "data:image/tiff;base64,SUkqAA==", "data:text/html,<script>alert(1)</script>"]) {
      const a = fensterAttrappe();
      assert.equal(inhaltImFensterZeigen(a.fenster, wert, { name: "Plan.svg", t, sonstHerunterladen: true }), true, wert);
      assert.equal(a.kinder.length, 2, wert);
      assert.equal(a.kinder[0].tag, "p");
      assert.equal(a.kinder[0].attribute.role, "note");
      assert.equal(a.kinder[0].textContent, M[G.INHALT_TYP]);
      assert.equal(a.kinder[1].tag, "a");
      assert.equal(a.kinder[1].href, wert);
      assert.equal(a.kinder[1].download, "Plan.svg");
      assert.ok(!a.kinder.some((k) => k.tag === "img" || k.tag === "iframe"), "never rendered");
    }
    for (const wert of ["javascript:alert(1)", "https://example.invalid/x.svg", "\\\\server\\share\\x.svg", null]) {
      const a = fensterAttrappe();
      assert.equal(inhaltImFensterZeigen(a.fenster, wert, { name: "x", t, sonstHerunterladen: true }), false, String(wert));
      assert.equal(a.kinder.length, 1);
      assert.equal(a.kinder[0].attribute.role, "alert");
    }
  });
});
