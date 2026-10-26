// 106-07: tablet - pointer kinds in the pick core (capture radius per kind, tap tolerance), the two-finger gesture tracker
// (pinch, twist, pan), the coarse layout switch, the rights lock of bestaetigen / rueckgaengig, and the control channel for a
// paired device (office mode): only selection and proposal commands reach a device, every request is answered only by the poller
// that took it, the agent side stays on this computer.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import * as THREE from "three";
import { zeigerArt, fangVersaetze, zeigerPick, FANG_RADIUS_PX, TIPP_TOLERANZ_PX } from "@core/lib/zeigen/strahlPick.js";
import { zweiFingerGeste, fingerLage, fingerSchritt, MIN_ABSTAND_PX } from "@core/lib/zeigen/zweiFinger.js";
import { grobeBedienung } from "@core/lib/zeigen/useZeigerArt.js";
import { befehlsRegister } from "@core/lib/befehlsregister.js";
import { aenderungsBefehleRegistrieren, KEIN_AENDERUNGSRECHT_TEXT } from "@core/lib/zeigen/aenderungsBefehle.js";
import { vorschlagSpeicher } from "@core/lib/zeigen/vorschlagSpeicher.js";
import { auswahlKontext } from "@core/lib/zeigen/auswahlKontext.js";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { darf, baueZugriff } from "@core/lib/rechte.js";
import { steuerungRouter, jsonAusserSteuerung, STEUERUNGS_KOPF, GERAET_BEFEHLE, geraetDarfZeile, zielDerZeile, aktivZeit, oberflaecheNennen, ABHOLER_GRENZEN, VOLL_KOPF } from "../../server/steuerungRouter.js";
import { starteSteuerungsBruecke, VOLL_PAUSE_MS } from "@core/lib/steuerungsBruecke.js";
import { geraetDarf } from "../../server/bueroRouter.js";
import { EN } from "@core/lib/i18nTeile/zeigen-106.js";
import { sprechSteuerung, MAX_AUFNAHME_MS } from "@core/lib/zeigen/sprechStart.js";
import { geraetSprechGrund, GERAET_OHNE_HARNESS, GERAET_OHNE_HTTPS, SPRECH_OHNE_HARNESS } from "../../src/lib/harnessClient.js";

// ---------------------------------------------------------------------------------------------------------------------------
// Pick core: pointer kinds

/** A 2 x 2 m plate at z = 0 seen straight from z = 10 m, on a 200 x 200 px canvas. */
function szene() {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  const kamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  kamera.position.set(0, 0, 10);
  kamera.lookAt(0, 0, 0);
  kamera.updateMatrixWorld(true);
  const dom = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) };
  // screen x of the plate's right edge: project (1, 0, 0)
  const rand = new THREE.Vector3(1, 0, 0).project(kamera);
  const randPx = ((rand.x + 1) / 2) * 200;
  return { mesh, kamera, dom, randPx };
}

describe("106-07 Zeigerarten im Pick-Kern", () => {
  it("zeigerArt: pen und touch bleiben, alles andere zählt als Maus (exakter Strahl ist die sichere Seite)", () => {
    assert.equal(zeigerArt({ pointerType: "pen" }), "pen");
    assert.equal(zeigerArt({ pointerType: "touch" }), "touch");
    assert.equal(zeigerArt({ pointerType: "mouse" }), "mouse");
    assert.equal(zeigerArt({ pointerType: "" }), "mouse");
    assert.equal(zeigerArt(null), "mouse");
    assert.ok(FANG_RADIUS_PX.touch > FANG_RADIUS_PX.pen && FANG_RADIUS_PX.pen > FANG_RADIUS_PX.mouse);
    assert.equal(FANG_RADIUS_PX.mouse, 0, "die Maus bleibt beim alten, exakten Strahl");
    assert.ok(TIPP_TOLERANZ_PX.touch > TIPP_TOLERANZ_PX.mouse);
  });

  it("fangVersaetze: Mitte zuerst, dann zwei Ringe mit je 8 Richtungen; Radius 0 nur die Mitte", () => {
    assert.deepEqual(fangVersaetze(0), [[0, 0]]);
    const v = fangVersaetze(18);
    assert.equal(v.length, 17);
    assert.deepEqual(v[0], [0, 0]);
    for (const [dx, dy] of v.slice(1, 9)) assert.ok(Math.abs(Math.hypot(dx, dy) - 9) < 0.01);
    for (const [dx, dy] of v.slice(9)) assert.ok(Math.abs(Math.hypot(dx, dy) - 18) < 0.01);
  });

  it("zeigerPick: exakter Treffer für alle Arten; knapp daneben trifft nur Finger/Stift im Fangradius, die Maus nie", () => {
    const { mesh, kamera, dom, randPx } = szene();
    for (const art of /** @type {const} */ (["mouse", "pen", "touch"])) {
      const t = zeigerPick(mesh, kamera, dom, 100, 100, { art });
      assert.ok(t, art);
      assert.deepEqual(t.versatzPx, [0, 0]);
    }
    const daneben = randPx + 6; // 6 px right of the plate's edge
    assert.equal(zeigerPick(mesh, kamera, dom, daneben, 100, { art: "mouse" }), null);
    const finger = zeigerPick(mesh, kamera, dom, daneben, 100, { art: "touch" });
    assert.ok(finger, "der Finger fängt die Platte 6 px neben der Kante");
    assert.ok(finger.versatzPx[0] < 0, "gefunden links vom Zeiger, also zur Platte hin");
    assert.ok(zeigerPick(mesh, kamera, dom, randPx + 3, 100, { art: "pen" }), "der Stift fängt 3 px daneben");
    assert.equal(zeigerPick(mesh, kamera, dom, randPx + 30, 100, { art: "touch" }), null, "30 px daneben ist auch für den Finger zu weit");
  });

  it("zeigerPick: ein unbekannter Treffer in der Mitte lässt die Ringe weitersuchen; bleibt nichts, kommt der Mitteltreffer zurück", () => {
    const { mesh, kamera, dom } = szene();
    const hinten = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    hinten.position.z = -5; hinten.userData.umgebung = true; hinten.updateMatrixWorld(true);
    mesh.position.x = 1.15; mesh.updateMatrixWorld(true); // the plate lies a little right of the screen middle
    const annehmen = (/** @type {any} */ t) => !t.objekt.userData.umgebung;
    const maus = zeigerPick([mesh, hinten], kamera, dom, 100, 100, { art: "mouse", annehmen });
    assert.equal(maus?.objekt, hinten, "Maus: wie bisher der Mitteltreffer, auch wenn ihn niemand kennt");
    const finger = zeigerPick([mesh, hinten], kamera, dom, 100, 100, { art: "touch", radiusPx: 40, annehmen });
    assert.equal(finger?.objekt, mesh, "Finger: das bekannte Bauteil im Fangradius gewinnt vor dem Hintergrund");
    const nichts = zeigerPick([hinten], kamera, dom, 100, 100, { art: "touch", annehmen });
    assert.equal(nichts?.objekt, hinten, "nichts Bekanntes in Reichweite: der Mitteltreffer, nicht geraten");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Two fingers

describe("106-07 Zwei-Finger-Geste", () => {
  it("fingerSchritt: Auseinander = Faktor > 1, Drehen im Uhrzeigersinn = positiv, kürzester Weg über ±PI", () => {
    const a = fingerLage({ x: 0, y: 0 }, { x: 100, y: 0 });
    const b = fingerLage({ x: 0, y: 0 }, { x: 200, y: 0 });
    assert.equal(fingerSchritt(a, b).faktor, 2);
    const gedreht = fingerLage({ x: 0, y: 0 }, { x: 0, y: 100 }); // screen y down: the second finger went clockwise by 90 degrees
    assert.ok(Math.abs(fingerSchritt(a, gedreht).drehungRad - Math.PI / 2) < 1e-9);
    const fast = fingerLage({ x: 0, y: 0 }, { x: -100, y: 1 });
    const druber = fingerLage({ x: 0, y: 0 }, { x: -100, y: -1 });
    assert.ok(Math.abs(fingerSchritt(fast, druber).drehungRad) < 0.05, "kein Sprung um 2 PI");
    const nah = fingerLage({ x: 0, y: 0 }, { x: MIN_ABSTAND_PX / 2, y: 0 });
    assert.deepEqual([fingerSchritt(nah, a).faktor, fingerSchritt(nah, a).drehungRad], [1, 0], "zwei Kontakte an einer Stelle: kein Zoom, kein Drehen");
  });

  it("Tracker: ein Finger meldet nichts, zwei melden Pinch, Drehen und Verschiebung; warGeste schützt vor dem Tipp beim Abheben", () => {
    const g = zweiFingerGeste();
    assert.equal(g.runter(1, 100, 100), 1);
    assert.equal(g.bewegt(1, 110, 100), null);
    assert.equal(g.warGeste(), false);
    assert.equal(g.runter(2, 200, 100), 2);
    assert.equal(g.warGeste(), true);
    const s = g.bewegt(2, 290, 100); // finger 1 is at 110: distance 90 → 180
    assert.ok(s);
    assert.equal(s.faktor, 2);
    assert.equal(s.dx, 45);
    assert.equal(g.bewegt(99, 0, 0), null, "unbekannter Zeiger");
    assert.equal(g.hoch(2), 1);
    assert.equal(g.warGeste(), true, "der letzte Finger nach der Geste wählt nichts");
    assert.equal(g.hoch(1), 0);
    g.runter(3, 50, 50);
    assert.equal(g.warGeste(), false, "ein neuer erster Finger beginnt frisch");
  });
});

describe("106-07 Tablet-Layout", () => {
  it("grobeBedienung: Finger oder Stift = grob; Maus = fein; ohne Zeiger entscheidet die Media-Query", () => {
    assert.equal(grobeBedienung("touch", false), true);
    assert.equal(grobeBedienung("pen", false), true);
    assert.equal(grobeBedienung("mouse", true), false);
    assert.equal(grobeBedienung(null, true), true);
    assert.equal(grobeBedienung(null, false), false);
  });

  it("die neuen Texte haben eine englische Fassung", () => {
    assert.ok(EN[KEIN_AENDERUNGSRECHT_TEXT]);
    assert.ok(EN["Nur ansehen und vorschlagen — Ihre Rolle darf das Modell nicht ändern"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Rights: confirming needs a role that may change the model

describe("106-07 Bestätigen nur mit Recht zum Ändern", () => {
  const P = "p1";
  const w = { a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, level: 0, thickness: 0.24, height: 3, _idx: 7, feuerwiderstand: "F30" };
  const guid = bauteilGuid(P, "customWalls", w);
  /** @param {{darf: boolean}} o */
  function flaeche(o) {
    const f = { modell: { customWalls: [w] }, darf: o.darf, speicher: vorschlagSpeicher(), angewendet: 0 };
    const reg = befehlsRegister();
    aenderungsBefehleRegistrieren(reg, () => ({
      kontext: () => auswahlKontext([]),
      modell: () => f.modell,
      optionen: () => ({ projektId: P, geschosshoehe_m: 3 }),
      speicher: f.speicher,
      uebernehmen: (_v, r) => { f.modell = r.modell; f.angewendet += 1; },
      zuruecknehmen: (_e, r) => { f.modell = r.modell; },
      darfAendern: () => f.darf,
    }));
    return { f, reg };
  }

  it("ohne Recht: vorschlagen und verwerfen gehen, bestaetigen und rueckgaengig werden in Worten verweigert", () => {
    const { f, reg } = flaeche({ darf: false });
    const v = reg.ausfuehren("eigenschaft-setzen", { guid, name: "feuerwiderstand", wert: "F90" });
    assert.equal(v.ok, true, JSON.stringify(v));
    const b = reg.ausfuehren("bestaetigen", { vorschlag_id: v.result.id, durch: "hand" });
    assert.equal(b.ok, false);
    assert.equal(/** @type {any} */ (b).error, KEIN_AENDERUNGSRECHT_TEXT);
    assert.equal(f.angewendet, 0);
    assert.equal(f.modell.customWalls[0].feuerwiderstand, "F30");
    assert.equal(f.speicher.offen().length, 1, "der Vorschlag wartet weiter auf eine Person mit Recht");
    // the person with the right confirms; then the role loses it: reversing is refused as well
    f.darf = true;
    assert.equal(reg.ausfuehren("bestaetigen", { vorschlag_id: v.result.id, durch: "hand" }).ok, true);
    assert.equal(f.modell.customWalls[0].feuerwiderstand, "F90");
    f.darf = false;
    const r = reg.ausfuehren("rueckgaengig", {});
    assert.equal(r.ok, false);
    assert.equal(/** @type {any} */ (r).error, KEIN_AENDERUNGSRECHT_TEXT);
    const v2 = reg.ausfuehren("eigenschaft-setzen", { guid: bauteilGuid(P, "customWalls", f.modell.customWalls[0]), name: "kg", wert: "331" });
    assert.equal(v2.ok, true);
    assert.equal(reg.ausfuehren("verwerfen", { vorschlag_id: v2.result.id }).ok, true, "verwerfen ändert nichts und bleibt offen");
  });

  it("ohne darfAendern (alte Fläche) bleibt alles wie bisher; das Recht kommt aus rechte.js (Modul modell, Stufe voll)", () => {
    const reg = befehlsRegister();
    const speicher = vorschlagSpeicher();
    let modell = { customWalls: [w] };
    aenderungsBefehleRegistrieren(reg, () => ({
      kontext: () => auswahlKontext([]), modell: () => modell, optionen: () => ({ projektId: P }), speicher,
      uebernehmen: (_v, r) => { modell = r.modell; }, zuruecknehmen: () => {},
    }));
    const v = reg.ausfuehren("eigenschaft-setzen", { guid, name: "feuerwiderstand", wert: "F60" });
    assert.equal(reg.ausfuehren("bestaetigen", { vorschlag_id: v.result.id }).ok, true);
    assert.equal(darf(baueZugriff({ rolle: "projektleitung" }), "modell", "voll"), true);
    assert.equal(darf(baueZugriff({ rolle: "buchhaltung" }), "modell", "voll"), false);
    assert.equal(darf(baueZugriff({ rolle: "mitarbeiter", lesemodus: true }), "modell", "voll"), false, "Nur-Lesen darf ansehen, nicht ändern");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Control channel for paired devices

const TOKEN = "t".repeat(48);
/**
 * Router as in server/index.js; a test header stands in for the office-mode gate: x-test-geraet = id of a paired device
 * (the gate sets req.bitZugang = {lokal: false, geraet}), x-test-fremd = an unpaired LAN address.
 */
async function mitServer(fn, optionen = {}) {
  const app = express();
  app.use((/** @type {any} */ req, _res, next) => {
    const g = req.headers["x-test-geraet"];
    req.bitZugang = g ? { lokal: false, geraet: { id: String(g) } } : req.headers["x-test-fremd"] ? { lokal: false, geraet: null } : { lokal: true, geraet: null };
    next();
  });
  app.use(jsonAusserSteuerung(10 * 1024 * 1024));
  app.use("/api", steuerungRouter({
    lokalGebunden: true, token: TOKEN, wartezeit: 600, abholWarten: 300,
    anfrageEntfernt: (/** @type {any} */ req) => req.bitZugang?.lokal === false,
    geraetVon: (/** @type {any} */ req) => req.bitZugang?.geraet?.id ?? null,
    ...optionen,
  }));
  const srv = app.listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  try { return await fn(`http://127.0.0.1:${/** @type {any} */ (srv.address()).port}`); } finally { srv.closeAllConnections?.(); srv.close(); }
}
const agentSendet = (basis, body, kopf = {}) => fetch(`${basis}/api/steuerung`, { method: "POST", headers: { "Content-Type": "application/json", [STEUERUNGS_KOPF]: TOKEN, ...kopf }, body: JSON.stringify(body) });
const ausfuehren = (id, befehl) => ({ id, method: "ausfuehren", params: { befehl, params: {} } });
const geraetKopf = { "x-test-geraet": "tablet-1" };

describe("106-07 Steuerkanal für gekoppelte Geräte", () => {
  it("Positivliste: Auswahl und Vorschläge ja; bestätigen, zurücknehmen, eingabe, Bild und Sofort-Befehle nie", () => {
    for (const b of ["auswahl-guid", "eigenschaft-setzen", "transformieren", "teilen", "verwerfen", "vorschlaege"]) assert.ok(GERAET_BEFEHLE.includes(b), b);
    for (const b of ["bestaetigen", "rueckgaengig", "eingabe", "ansicht-bild", "linie", "wand", "loeschen"]) {
      assert.equal(geraetDarfZeile(JSON.stringify(ausfuehren(1, b))), false, b);
    }
    assert.equal(geraetDarfZeile(JSON.stringify({ id: 1, method: "befehle" })), true);
    assert.equal(geraetDarfZeile("kein json"), false);
    assert.equal(geraetDarfZeile(JSON.stringify({ id: 1, method: "ausfuehren", params: {} })), false);
  });

  it("Büro-Wächter lässt ein Gerät nur an die App-Seite (abholen, antworten), nie an die Agenten-Seite", () => {
    assert.equal(geraetDarf("GET", "/api/steuerung/naechste"), true);
    assert.equal(geraetDarf("POST", "/api/steuerung/antwort"), true);
    assert.equal(geraetDarf("POST", "/api/steuerung"), false);
    assert.equal(geraetDarf("POST", "/api/steuerung/naechste"), false);
    assert.equal(geraetDarf("GET", "/api/Steuerung/naechste"), false, "andere Schreibweise wird nicht durchgelassen");
  });

  it("ein Gerät holt einen Auswahl-Befehl ab und beantwortet ihn; die Agenten-Seite bleibt ihm verschlossen", async () => {
    await mitServer(async (basis) => {
      const holen = fetch(`${basis}/api/steuerung/naechste?aktiv=5`, { headers: geraetKopf });
      await new Promise((r) => setTimeout(r, 50));
      const agent = agentSendet(basis, ausfuehren("a1", "auswahl-guid"));
      const abgeholt = await holen;
      assert.equal(abgeholt.status, 200);
      const { nr, zeile } = await abgeholt.json();
      assert.equal(JSON.parse(zeile).params.befehl, "auswahl-guid");
      // the computer cannot answer for the device
      assert.equal((await fetch(`${basis}/api/steuerung/antwort`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nr, antwort: "{}" }) })).status, 404);
      const ok = await fetch(`${basis}/api/steuerung/antwort`, { method: "POST", headers: { "Content-Type": "application/json", ...geraetKopf }, body: JSON.stringify({ nr, antwort: JSON.stringify({ id: "a1", ok: true, result: "gewählt" }) }) });
      assert.equal(ok.status, 200);
      assert.deepEqual(await (await agent).json(), { id: "a1", ok: true, result: "gewählt", oberflaeche: "geraet:tablet-1" }, "the agent learns which surface answered");
      // the agent side: never from a device, never from an unpaired LAN address
      assert.equal((await agentSendet(basis, ausfuehren("x", "auswahl-lesen"), geraetKopf)).status, 403);
      assert.equal((await fetch(`${basis}/api/steuerung/naechste`, { headers: { "x-test-fremd": "1" } })).status, 403);
    });
  });

  it("bestaetigen erreicht nie ein Gerät: wartet nur das Gerät, kommt not-run; ein Tab am Rechner bekommt ihn", async () => {
    await mitServer(async (basis) => {
      const holen = fetch(`${basis}/api/steuerung/naechste?alter=0`, { headers: geraetKopf }); // the device is the most recently active
      await new Promise((r) => setTimeout(r, 50));
      const r = await agentSendet(basis, ausfuehren("b1", "bestaetigen"));
      assert.equal(r.status, 504);
      assert.equal((await r.json()).status, "not-run");
      assert.equal((await holen).status, 204, "das Gerät bekam nichts");
      // with a tab of this computer waiting as well, the request goes there although the device was active later
      const geraet = fetch(`${basis}/api/steuerung/naechste?alter=0`, { headers: geraetKopf });
      const lokal = fetch(`${basis}/api/steuerung/naechste?alter=600000`);
      await new Promise((r2) => setTimeout(r2, 50));
      const agent = agentSendet(basis, ausfuehren("b2", "bestaetigen"));
      const l = await lokal;
      assert.equal(l.status, 200);
      const { nr } = await l.json();
      // the device may not answer the computer's request
      assert.equal((await fetch(`${basis}/api/steuerung/antwort`, { method: "POST", headers: { "Content-Type": "application/json", ...geraetKopf }, body: JSON.stringify({ nr, antwort: "{}" }) })).status, 404);
      await fetch(`${basis}/api/steuerung/antwort`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nr, antwort: JSON.stringify({ id: "b2", ok: false, error: "Ein Agent kann nicht bestätigen" }) }) });
      assert.equal((await (await agent).json()).ok, false);
      assert.equal((await geraet).status, 204);
    });
  });

  it("Review-Fix: lokaler Tab und Gerät warten, das Gerät ist zuletzt aktiv (auch mit aktiv=9e15) — trotzdem bekommt der lokale Tab auswahl-lesen", async () => {
    await mitServer(async (basis) => {
      const geraet = fetch(`${basis}/api/steuerung/naechste?aktiv=9000000000000000`, { headers: geraetKopf });
      const lokal = fetch(`${basis}/api/steuerung/naechste?alter=600000`); // unfocused for 10 minutes: the person works in the terminal
      await new Promise((r) => setTimeout(r, 50));
      const agent = agentSendet(basis, ausfuehren("c1", "auswahl-lesen"));
      const l = await lokal;
      assert.equal(l.status, 200, "the tab of this computer took the request");
      const { nr } = await l.json();
      await fetch(`${basis}/api/steuerung/antwort`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nr, antwort: JSON.stringify({ id: "c1", ok: true, result: { anzahl: 0 } }) }) });
      assert.deepEqual(await (await agent).json(), { id: "c1", ok: true, result: { anzahl: 0 } }, "an answer of this computer is unchanged (no oberflaeche)");
      assert.equal((await geraet).status, 204, "the device got nothing");
    });
  });

  it("Review-Fix: in der Lücke zwischen zwei Abfragen des lokalen Tabs bekommt das Gerät nichts; mit ziel geht es ans Gerät", async () => {
    await mitServer(async (basis) => {
      // one local poll that ends empty: the tab counts as around for lokalNachlauf afterwards
      assert.equal((await fetch(`${basis}/api/steuerung/naechste?alter=0`)).status, 204);
      const geraet = fetch(`${basis}/api/steuerung/naechste?alter=0`, { headers: geraetKopf });
      await new Promise((r) => setTimeout(r, 30));
      const agent = agentSendet(basis, ausfuehren("d1", "auswahl-lesen"));
      // the device's poll ends without the request; the next local poll finds it waiting
      assert.equal((await geraet).status, 204, "a request in the gap stays for the computer");
      const l = await fetch(`${basis}/api/steuerung/naechste?alter=0`);
      assert.equal(l.status, 200);
      const { nr } = await l.json();
      await fetch(`${basis}/api/steuerung/antwort`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nr, antwort: JSON.stringify({ id: "d1", ok: true, result: 1 }) }) });
      assert.equal((await (await agent).json()).ok, true);
      // named for the device: it goes there although a tab of this computer waits
      const lokal2 = fetch(`${basis}/api/steuerung/naechste?alter=0`);
      const geraet2 = fetch(`${basis}/api/steuerung/naechste?alter=0`, { headers: geraetKopf });
      await new Promise((r) => setTimeout(r, 30));
      const agent2 = agentSendet(basis, { ...ausfuehren("d2", "auswahl-lesen"), ziel: "geraet:tablet-1" });
      const g = await geraet2;
      assert.equal(g.status, 200, "ziel geraet:<id> reaches the device");
      const z = await g.json();
      await fetch(`${basis}/api/steuerung/antwort`, { method: "POST", headers: { "Content-Type": "application/json", ...geraetKopf }, body: JSON.stringify({ nr: z.nr, antwort: JSON.stringify({ id: "d2", ok: true, result: 2 }) }) });
      assert.equal((await (await agent2).json()).oberflaeche, "geraet:tablet-1");
      assert.equal((await lokal2).status, 204, "a request named for a device never goes to this computer");
    }, { abholWarten: 150, lokalNachlauf: 1000 });
  });

  it("Review-Fix: ziel lokal geht nie an ein Gerät, ziel mit anderer Geräte-Id auch nicht", async () => {
    await mitServer(async (basis) => {
      const holen = fetch(`${basis}/api/steuerung/naechste?alter=0`, { headers: geraetKopf });
      await new Promise((r) => setTimeout(r, 30));
      const r = await agentSendet(basis, { ...ausfuehren("e1", "auswahl-lesen"), ziel: "lokal" });
      assert.equal(r.status, 504, "ziel lokal: the device does not take it");
      assert.equal((await holen).status, 204);
      const fremd = fetch(`${basis}/api/steuerung/naechste?alter=0`, { headers: geraetKopf });
      await new Promise((r2) => setTimeout(r2, 30));
      assert.equal((await agentSendet(basis, { ...ausfuehren("e2", "auswahl-lesen"), ziel: "geraet:anderes" })).status, 504);
      assert.equal((await fremd).status, 204, "a request named for another device is not taken");
    });
  });

  it("Review-Fix: Abholer-Plätze je Art — Geräte nehmen dem Rechner keinen Platz, volle Liste = 204 mit Kopf", async () => {
    await mitServer(async (basis) => {
      const offen = [];
      for (let i = 0; i < ABHOLER_GRENZEN.jeGeraet; i++) offen.push(fetch(`${basis}/api/steuerung/naechste`, { headers: geraetKopf }));
      await new Promise((r) => setTimeout(r, 30));
      const zuViel = await fetch(`${basis}/api/steuerung/naechste`, { headers: geraetKopf });
      assert.equal(zuViel.status, 204);
      assert.equal(zuViel.headers.get(VOLL_KOPF), "1");
      const lokal = fetch(`${basis}/api/steuerung/naechste`);
      await new Promise((r) => setTimeout(r, 30));
      const agent = agentSendet(basis, ausfuehren("f1", "auswahl-lesen"));
      const l = await lokal;
      assert.equal(l.status, 200, "this computer still has its places");
      const { nr } = await l.json();
      await fetch(`${basis}/api/steuerung/antwort`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nr, antwort: JSON.stringify({ id: "f1", ok: true, result: 0 }) }) });
      await agent;
      await Promise.all(offen);
    });
  });

  it("Review-Fix: aktivZeit rechnet in Serverzeit; zielDerZeile; oberflaecheNennen nur für Geräte", () => {
    assert.equal(aktivZeit({ alter: "250" }, 10_000), 9_750);
    assert.equal(aktivZeit({ alter: "-5" }, 10_000), 10_000, "a negative age is now");
    assert.equal(aktivZeit({ aktiv: "9000000000000000" }, 10_000), 10_000, "the old client-clock form is capped at now");
    assert.equal(aktivZeit({}, 10_000), 0);
    assert.deepEqual(zielDerZeile(JSON.stringify({ ziel: "geraet:t1" })), { art: "geraet", geraet: "t1" });
    assert.deepEqual(zielDerZeile(JSON.stringify({ ziel: "geraet" })), { art: "geraet", geraet: null });
    assert.deepEqual(zielDerZeile(JSON.stringify({ ziel: "lokal" })), { art: "lokal", geraet: null });
    assert.deepEqual(zielDerZeile("{}"), { art: "frei", geraet: null });
    assert.equal(oberflaecheNennen('{"ok":true}', "lokal"), '{"ok":true}');
    assert.equal(JSON.parse(oberflaecheNennen('{"ok":true}', "geraet:t1")).oberflaeche, "geraet:t1");
    assert.equal(oberflaecheNennen("kein json", "geraet:t1"), "kein json");
  });

  it("Review-Fix: die Brücke meldet das Alter der Aktivität und pausiert nach 204 mit voll-Kopf", async () => {
    /** @type {string[]} */ const urls = [];
    /** @type {number[]} */ const pausen = [];
    let n = 0;
    /** @type {() => void} */ let stopp = () => {};
    await new Promise((fertig) => {
      const fetchFn = async (/** @type {any} */ url) => {
        urls.push(String(url));
        n += 1;
        if (n >= 3) { stopp(); fertig(null); }
        return /** @type {any} */ ({ status: 204, ok: true, headers: { get: (/** @type {string} */ k) => (k === VOLL_KOPF && n === 1 ? "1" : null) } });
      };
      stopp = starteSteuerungsBruecke({ zeileBearbeiten: () => "{}" }, { fetchFn: /** @type {any} */ (fetchFn), pause: async (ms) => { pausen.push(ms); }, aktivSeit: () => Date.now() - 1000 });
    });
    assert.match(urls[0], /\/api\/steuerung\/naechste\?alter=\d+$/);
    assert.ok(Number(/alter=(\d+)/.exec(urls[0])?.[1]) >= 1000);
    assert.deepEqual(pausen, [VOLL_PAUSE_MS], "only the full list pauses; a normal 204 asks again at once (long poll)");
  });

  it("ohne geraetVon (wie vor 106-07) bleibt ein Gerät auch an der App-Seite draußen", async () => {
    await mitServer(async (basis) => {
      assert.equal((await fetch(`${basis}/api/steuerung/naechste`, { headers: geraetKopf })).status, 403);
    }, { geraetVon: () => null });
  });

  it("server/index.js reicht die Geräte-Id des Büro-Wächters an den Router", () => {
    const quelle = fs.readFileSync(new URL("../../server/index.js", import.meta.url), "utf8");
    assert.match(quelle, /geraetVon: \(req\) => req\.bitZugang\?\.geraet\?\.id \?\? null/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Review 106-07: a lost release never leaves the microphone open

describe("106-07 Review-Fix: Höchstdauer der Aufnahme", () => {
  it("nach hoechstMs endet die Aufnahme über beiHoechst (wie Loslassen); ohne beiHoechst wird sie verworfen; Loslassen davor stoppt die Uhr", async () => {
    const streams = [];
    const aufnehmen = async () => { const s = { offen: true }; streams.push(s); return { stoppen: async () => { s.offen = false; return null; }, abbrechen: () => { s.offen = false; } }; };
    let gestoppt = 0;
    /** @type {any} */ let st = null;
    st = sprechSteuerung({ vorbereiten: () => true, aufnehmen, hoechstMs: 30, beiHoechst: () => { gestoppt += 1; void st.stoppen(); } });
    await st.starten();
    assert.equal(st.offen(), true);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(gestoppt, 1);
    assert.equal(st.offen(), false);
    assert.equal(streams[0].offen, false, "the microphone is closed");
    const ohne = sprechSteuerung({ vorbereiten: () => true, aufnehmen, hoechstMs: 30 });
    await ohne.starten();
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(streams[1].offen, false, "without beiHoechst the recording is dropped");
    let spaet = 0;
    const normal = sprechSteuerung({ vorbereiten: () => true, aufnehmen, hoechstMs: 30, beiHoechst: () => { spaet += 1; } });
    await normal.starten();
    await normal.stoppen();
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(spaet, 0, "a normal release clears the timer");
    assert.ok(MAX_AUFNAHME_MS >= 10_000);
  });
});

describe("106-07 Review-Fix: Sprache am gekoppelten Gerät", () => {
  it("geraetSprechGrund: am Rechner nichts; am Gerät mit Harness auf 127.0.0.1 = Harness nur am Rechner; ohne HTTPS = kein Mikrofon", () => {
    const h = "http://127.0.0.1:8765";
    assert.equal(geraetSprechGrund({ seiteHost: "localhost", sicher: true, aufnahmeDa: true, harnessUrl: h }), "");
    assert.equal(geraetSprechGrund({ seiteHost: "127.0.0.1", sicher: true, aufnahmeDa: true, harnessUrl: h }), "");
    assert.equal(geraetSprechGrund({ seiteHost: "tauri.localhost", sicher: true, aufnahmeDa: true, harnessUrl: h }), "");
    assert.equal(geraetSprechGrund({ seiteHost: "", sicher: true, aufnahmeDa: true, harnessUrl: h }), "", "an app shell without host is this computer");
    assert.equal(geraetSprechGrund({ seiteHost: "192.168.178.20", sicher: false, aufnahmeDa: false, harnessUrl: h }), GERAET_OHNE_HARNESS);
    assert.equal(geraetSprechGrund({ seiteHost: "192.168.178.20", sicher: false, aufnahmeDa: false, harnessUrl: "http://192.168.178.20:8765" }), GERAET_OHNE_HTTPS);
    assert.equal(geraetSprechGrund({ seiteHost: "buero.lan", sicher: true, aufnahmeDa: true, harnessUrl: "https://buero.lan:8765" }), "");
    assert.notEqual(GERAET_OHNE_HARNESS, SPRECH_OHNE_HARNESS, "a sentence of its own, not the general harness hint");
    assert.ok(EN[GERAET_OHNE_HARNESS] && EN[GERAET_OHNE_HTTPS]);
  });
});
