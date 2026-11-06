// 106-08: VR session (WebXR) - availability, rig maths, controller ray -> the pick core of 106-01, the floating panel, and the
// session plumbing against a WebXR STAND-IN (fake navigator.xr, fake session, fake renderer.xr with three's controller groups).
// Pose -> hit -> hover / select -> proposal on the panel -> "Übernehmen" by the person (ray on the panel button + trigger, or button A)
// through the SAME command `bestaetigen` (durch "hand") and the same rights check as on the screen (106-07).
// Not a device test (D-IM-03 / D-AW-04): no real headset is involved.
// Style: node:test, German titles.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";

import { xrVerfuegbarkeit, xrStartFehlerText, XR_GRUENDE } from "@core/lib/zeigen/xrVerfuegbar.js";
import {
  rigFuerModus, userZuWelt, weltZuUser, rigMatrix, rigGleiten, rigDrehen, rigTeleport, controllerStrahl, tastenAus, flanken,
  teleportZiel, xrSteuerung, xrSitzung, TISCH_GROESSE_M, TISCH_HOEHE_M, ABSTAND_1_1_M, DREH_SCHRITT_RAD, GLEIT_M_S,
} from "@core/lib/zeigen/xrSitzung.js";
import { tafelInhalt, tafelLayout, tafelKnopfBei, tafelZeichnen, umbrechen, TAFEL_FARBEN } from "@core/lib/zeigen/xrTafel.js";
import { strahlPick, identitaetAus, weltNormale } from "@core/lib/zeigen/strahlPick.js";
import { befehlsRegister } from "@core/lib/befehlsregister.js";
import { aenderungsBefehleRegistrieren, KEIN_AENDERUNGSRECHT_TEXT } from "@core/lib/zeigen/aenderungsBefehle.js";
import { vorschlagSpeicher } from "@core/lib/zeigen/vorschlagSpeicher.js";
import { auswahlKontext } from "@core/lib/zeigen/auswahlKontext.js";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { EN } from "@core/lib/i18nTeile/zeigen-106.js";
import { ansichtAlsPng, xrZeigtGerade, XR_KEIN_BILD_TEXT } from "@core/lib/zeigen/ansichtBild.js";

const nah = (a, b, tol = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

describe("106-08 Verfügbarkeit: ohne WebXR-Gerät kein Knopf, Fehler im Klartext", () => {
  it("unsicher (LAN ohne HTTPS, gekoppeltes Gerät), ohne navigator.xr, ohne Gerät, Prüffehler, mit Gerät", async () => {
    assert.deepEqual(await xrVerfuegbarkeit({ isSecureContext: false, navigator: { xr: { isSessionSupported: async () => true } } }),
      { ok: false, grund: XR_GRUENDE.unsicher });
    assert.deepEqual(await xrVerfuegbarkeit({ isSecureContext: true, navigator: {} }), { ok: false, grund: XR_GRUENDE.keinWebxr });
    assert.deepEqual(await xrVerfuegbarkeit({ isSecureContext: true, navigator: { xr: { isSessionSupported: async () => false } } }),
      { ok: false, grund: XR_GRUENDE.keinGeraet });
    assert.deepEqual(await xrVerfuegbarkeit({ isSecureContext: true, navigator: { xr: { isSessionSupported: async () => { throw new Error("x"); } } } }),
      { ok: false, grund: XR_GRUENDE.pruefFehler });
    /** @type {string[]} */
    const gefragt = [];
    assert.deepEqual(await xrVerfuegbarkeit({ isSecureContext: true, navigator: { xr: { isSessionSupported: async (m) => { gefragt.push(m); return true; } } } }),
      { ok: true, grund: null });
    assert.deepEqual(gefragt, ["immersive-vr"]);
  });

  it("Startfehler werden zu deutschen Sätzen", () => {
    const fehler = (name) => Object.assign(new Error("raw"), { name });
    assert.equal(xrStartFehlerText(fehler("NotSupportedError")).grund, XR_GRUENDE.nichtUnterstuetzt);
    assert.equal(xrStartFehlerText(fehler("NotAllowedError")).grund, XR_GRUENDE.nichtErlaubt);
    assert.equal(xrStartFehlerText(fehler("SecurityError")).grund, XR_GRUENDE.nichtErlaubt);
    assert.equal(xrStartFehlerText(fehler("InvalidStateError")).grund, XR_GRUENDE.laeuftSchon);
    assert.deepEqual(xrStartFehlerText(fehler("Irgendwas")), { grund: XR_GRUENDE.unbekannt, detail: "raw" });
  });

  it("alle Gründe haben einen englischen Text", () => {
    for (const g of Object.values(XR_GRUENDE)) assert.ok(EN[g], `EN fehlt: ${g}`);
  });
});

describe("106-08 Rig: Maßstab 1:1 und Tischmodell, Gleiten, Drehen, Teleport", () => {
  const box = { min: [-10, 2, -4], max: [30, 14, 6] };

  it("1:1: die Person steht 3 m vor der Vorderkante auf dem untersten Punkt, Maßstab 1", () => {
    const r = rigFuerModus("1:1", box);
    assert.deepEqual(r, { x: 10, y: 2, z: 6 + ABSTAND_1_1_M, drehungRad: 0, massstab: 1 });
  });

  it("Tischmodell: größte Ausdehnung 1 m, Unterkante auf Tischhöhe vor der Person", () => {
    const r = rigFuerModus("tisch", box);
    assert.equal(r.massstab, 40 / TISCH_GROESSE_M);
    assert.ok(nah(userZuWelt(r, [0, TISCH_HOEHE_M, -0.9]), [10, 2, 1], 1e-9), "Tischmitte = Modellmitte unten");
    const a = weltZuUser(r, [box.min[0], 2, 1]);
    const b = weltZuUser(r, [box.max[0], 2, 1]);
    assert.ok(Math.abs(b[0] - a[0] - TISCH_GROESSE_M) < 1e-9, "40 m erscheinen 1 m breit");
  });

  it("ohne Modell: Ersatz-Box, keine NaN", () => {
    const r = rigFuerModus("tisch", null);
    assert.ok(Object.values(r).every(Number.isFinite));
  });

  it("weltZuUser ist die Umkehrung von userZuWelt, rigMatrix rechnet dasselbe", () => {
    const r = { x: 3, y: -1, z: 7, drehungRad: 0.7, massstab: 12 };
    const p = [0.3, 1.2, -0.8];
    assert.ok(nah(weltZuUser(r, userZuWelt(r, p)), p, 1e-9));
    const m = rigMatrix(r);
    const v = new THREE.Vector3(...p).applyMatrix4(m);
    assert.ok(nah([v.x, v.y, v.z], userZuWelt(r, p), 1e-9));
    const mLocal = rigMatrix(r, 1.6);
    const w = new THREE.Vector3(0, 0, 0).applyMatrix4(mLocal);
    assert.ok(Math.abs(w.y - (r.y + 1.6 * r.massstab)) < 1e-9, "Ursprung von local liegt auf Augenhöhe");
  });

  it("Gleiten: entlang des Strahls, im Tischmaßstab schneller, Totzone, kein Sprung bei hängendem Frame", () => {
    const r = { x: 0, y: 0, z: 0, drehungRad: 0, massstab: 1 };
    const g = rigGleiten(r, [0, -2], 1, 0.05);
    assert.ok(nah([g.x, g.z], [0, -GLEIT_M_S * 0.05], 1e-9));
    assert.equal(rigGleiten(r, [0, -1], 0.1, 0.5), r, "Totzone");
    assert.equal(rigGleiten(r, [0, 0], 1, 0.5), r, "senkrechter Strahl");
    const k = rigGleiten({ ...r, massstab: 10 }, [1, 0], 1, 5);
    assert.ok(Math.abs(k.x - GLEIT_M_S * 10 * 0.1) < 1e-9, "höchstens 0,1 s je Frame");
  });

  it("Drehen: der Kopf bleibt an seiner Stelle, Schritt 30°", () => {
    const r = { x: 4, y: 0, z: -2, drehungRad: 0.2, massstab: 3 };
    const kopf = [0.4, 0, -0.3];
    const kopfWelt = userZuWelt(r, kopf);
    const d = rigDrehen(r, [kopfWelt[0], kopfWelt[2]], -DREH_SCHRITT_RAD);
    assert.ok(nah(userZuWelt(d, kopf), kopfWelt, 1e-9));
    assert.ok(Math.abs(d.drehungRad - (0.2 - Math.PI / 6)) < 1e-12);
  });

  it("Teleport: der Boden unter dem Kopf landet auf dem Ziel", () => {
    const r = { x: 1, y: 0, z: 1, drehungRad: 1.1, massstab: 1 };
    const t = rigTeleport(r, [8, 3, -4], [0.5, -0.2]);
    assert.ok(nah(userZuWelt(t, [0.5, 0, -0.2]), [8, 3, -4], 1e-9));
  });

  it("Teleportziel: Boden-Ebene, Decke von oben, Wand im Weg nein, nach oben nein, zu weit nein", () => {
    const s = { ursprung: [0, 1.6, 0], richtung: [0, -1, -1] };
    assert.ok(nah(teleportZiel(s, null, 0, 30), [0, 0, -1.6], 1e-9));
    assert.deepEqual(teleportZiel(s, { punkt: [0, 3, -2], normal: [0, 1, 0] }, 0, 30), [0, 3, -2]);
    assert.equal(teleportZiel(s, { punkt: [0, 1, -1], normal: [0, 0, 1] }, 0, 30), null);
    assert.equal(teleportZiel({ ursprung: [0, 1.6, 0], richtung: [0, 0.2, -1] }, null, 0, 30), null);
    assert.equal(teleportZiel({ ursprung: [0, 1.6, 0], richtung: [0, -0.01, -1] }, null, 0, 30), null);
  });
});

describe("106-08 Controller: Pose -> Strahl, Tasten nach xr-standard", () => {
  it("Strahl entlang -Z der Controller-Pose, auch im skalierten Rig", () => {
    const rig = new THREE.Group();
    rig.matrixAutoUpdate = false;
    rigMatrix({ x: 10, y: 0, z: 5, drehungRad: 0, massstab: 2 }, 0, rig.matrix);
    const c = new THREE.Group();
    rig.add(c);
    c.position.set(0, 1, 0);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0));
    rig.updateMatrixWorld(true);
    const s = controllerStrahl(c);
    assert.ok(nah(s.ursprung, [10, 2, 5], 1e-9));
    assert.ok(nah(s.richtung, [1, 0, 0], 1e-9));
  });

  it("Tasten: Abzug, Griff, Stick, A, B; Hand ohne Gamepad über das select-Ereignis; Flanken", () => {
    const knopf = (p) => ({ pressed: p });
    const g = { buttons: [knopf(true), knopf(false), knopf(false), knopf(true), knopf(false), knopf(true)], axes: [0, 0, 0.5, -0.9] };
    assert.deepEqual(tastenAus(g), { tasten: { trigger: true, griff: false, stick: true, a: false, b: true }, achsen: [0.5, -0.9] });
    assert.deepEqual(tastenAus(null, true).tasten, { trigger: true, griff: false, stick: false, a: false, b: false });
    assert.deepEqual(tastenAus({ buttons: [], axes: [0.3, NaN] }).achsen, [0.3, 0]);
    const f = flanken({ trigger: false, griff: true, stick: false, a: false, b: false }, { trigger: true, griff: false, stick: false, a: false, b: false });
    assert.deepEqual(f, { runter: ["trigger"], hoch: ["griff"] });
  });
});

describe("106-08 Tafel: Wörter, Form und Knöpfe", () => {
  const v = { id: "v1", satz: "Wand 1: Feuerwiderstand F30 → F90", pruefung: { stufe: "ok", saetze: [] }, herkunft: "sprache", herkunft_quellen: ["sprache"] };

  it("mit Vorschlag: Satz, Prüfung, Herkunft, Übernehmen aktiv; ohne Recht aus mit Grund; bei Fehler gesperrt mit durchgezogenem Rahmen", () => {
    const a = tafelInhalt({ zeigt: "Wand · W1", auswahl: "Wand · W1", sprechen: { zustand: "bereit" }, vorschlag: v, offenAnzahl: 1, darfAendern: true, modus: "1:1" });
    assert.ok(a.zeilen.some((z) => z.text.includes("F90") && z.art === "titel"));
    assert.ok(a.zeilen.some((z) => z.text === "Herkunft: Spracheingabe"));
    assert.deepEqual(a.knoepfe.map((k) => [k.id, k.aktiv]), [["uebernehmen", true], ["verwerfen", true], ["massstab", true], ["beenden", true]]);
    const ohne = tafelInhalt({ vorschlag: v, darfAendern: false, sprechen: null });
    assert.equal(ohne.knoepfe.find((k) => k.id === "uebernehmen")?.aktiv, false);
    assert.ok(ohne.zeilen.some((z) => z.art === "info" && z.text.includes("Ihre Rolle darf das Modell nicht ändern") && z.rahmen === "gepunktet"));
    const gesperrt = tafelInhalt({ vorschlag: { ...v, pruefung: { stufe: "fehler", saetze: ["Tragende Wand"] }, gesperrt: true }, darfAendern: true });
    assert.equal(gesperrt.knoepfe.find((k) => k.id === "uebernehmen")?.aktiv, false);
    assert.ok(gesperrt.zeilen.some((z) => z.art === "fehler" && z.text.startsWith("✕") && z.rahmen === "durchgezogen"));
    const warn = tafelInhalt({ vorschlag: { ...v, pruefung: { stufe: "warn", saetze: ["Achtung"] } } });
    assert.ok(warn.zeilen.some((z) => z.art === "warnung" && z.text.startsWith("▲") && z.rahmen === "gestrichelt"));
  });

  it("Sprechen: Aufnahme mit Punkt, Gehörtes, wartendes „ja“ mit Abbrechen, Rückfrage, Cloud-Frage; Antwort mit Zeichen", () => {
    const a = tafelInhalt({ sprechen: { zustand: "aufnahme", gehoert: "setze Brandschutz auf F90", halt: { was: "F90" }, rueckfrage: "Schritt zurücknehmen?", cloud: { anbieter: "fern" }, antwort: { text: "Nein", stufe: "fehler" } } });
    const texte = a.zeilen.map((z) => z.text);
    assert.ok(texte.some((x) => x.startsWith("● Aufnahme")));
    assert.ok(texte.includes("Gehört: „setze Brandschutz auf F90“"));
    assert.ok(texte.some((x) => x.startsWith("? Wird gleich übernommen: F90")));
    assert.ok(texte.some((x) => x.startsWith("✕ Nein")));
    assert.deepEqual(a.knoepfe.map((k) => k.id), ["abbrechen", "rueckfrage-ja", "rueckfrage-nein", "cloud-ja", "cloud-nein", "massstab", "beenden"]);
  });

  it("Layout: Knöpfe unten, Treffer per u/v, Umbruch; Zeichnen mit Form (gepunktet für gesperrt)", () => {
    const l = tafelLayout(tafelInhalt({ vorschlag: v, darfAendern: false }));
    const ueb = l.knoepfe.find((k) => k.id === "uebernehmen");
    assert.ok(ueb);
    const u = (ueb.x + ueb.w / 2) / l.breite, w = (ueb.y + ueb.h / 2) / l.hoehe;
    assert.equal(tafelKnopfBei(l, u, w)?.id, "uebernehmen");
    assert.equal(tafelKnopfBei(l, 0.5, 0.05), null);
    assert.equal(tafelKnopfBei(l, 1.2, 0.5), null);
    assert.deepEqual(umbrechen("eins zwei drei vier", 9), ["eins zwei", "drei vier"]);
    /** @type {any[]} */
    const aufrufe = [];
    const ctx = new Proxy({}, { get: (_o, k) => (typeof k === "string" && /^(fill|stroke|set)/.test(k) && !["fillStyle", "strokeStyle"].includes(k)
      ? (...a) => aufrufe.push([k, ...a]) : undefined), set: () => true });
    tafelZeichnen(/** @type {any} */ (ctx), l);
    assert.ok(aufrufe.some((a) => a[0] === "fillText" && String(a[1]).startsWith("Übernehmen")));
    assert.ok(aufrufe.some((a) => a[0] === "setLineDash" && a[1].length === 2 && a[1][0] === 3), "gesperrter Knopf gepunktet");
  });

  it("Tafel-Farben sind Kopien der hellen Tokens aus index.css", () => {
    const css = readFileSync(new URL("../../packages/nova-core/src/index.css", import.meta.url), "utf8");
    const hex = (name) => {
      const m = css.match(new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)\\s+(\\d+(?:\\.\\d+)?)%\\s+(\\d+(?:\\.\\d+)?)%`));
      assert.ok(m, name);
      const [h, s, l] = [Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100];
      const a = s * Math.min(l, 1 - l);
      const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
      return [f(0), f(8), f(4)].map((x) => Math.round(x * 255));
    };
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    for (const [feld, token] of [["flaeche", "card"], ["text", "foreground"], ["leise", "muted-foreground"], ["primaer", "primary"], ["primaerText", "primary-foreground"]]) {
      const d = Math.max(...rgb(TAFEL_FARBEN[feld]).map((v, i) => Math.abs(v - hex(token)[i])));
      assert.ok(d <= 1, `${feld} ≠ --${token}`);
    }
  });
});

// ---- the model and the register of a viewer, as in the 106-07 test ----
const P = "p1";
const WAND = { a: { x: -3, z: 0 }, b: { x: 3, z: 0 }, level: 0, thickness: 0.24, height: 3, _idx: 7, feuerwiderstand: "F30" };
const GUID = bauteilGuid(P, "customWalls", WAND);

function viewer({ darf = true } = {}) {
  const f = { modell: { customWalls: [WAND] }, darf, speicher: vorschlagSpeicher(), angewendet: 0 };
  const reg = befehlsRegister();
  aenderungsBefehleRegistrieren(reg, () => ({
    kontext: () => auswahlKontext([]), modell: () => f.modell, optionen: () => ({ projektId: P, geschosshoehe_m: 3 }), speicher: f.speicher,
    uebernehmen: (_v, r) => { f.modell = r.modell; f.angewendet += 1; }, zuruecknehmen: (_e, r) => { f.modell = r.modell; },
    darfAendern: () => f.darf,
  }));
  /** @type {string[]} */
  const aufrufe = [];
  const befehle = { ausfuehren: (id, p, ctx) => { aufrufe.push(id); return reg.ausfuehren(id, p, ctx); } };
  // the wall as a mesh: 6 m wide, 3 m high, centred on z = 0
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.24), new THREE.MeshBasicMaterial());
  mesh.position.set(0, 1.5, 0);
  mesh.updateMatrixWorld(true);
  /** @type {any[]} */
  const hover = [];
  /** @type {any[]} */
  const gewaehlt = [];
  const quelle = {
    treffen: (strahl) => {
      const tr = strahlPick(mesh, strahl);
      const id = identitaetAus(tr, () => ({ guid: GUID }));
      return id && tr ? { guid: id.guid, text: "Wand · W1", punkt: id.punkt, abstand: id.abstand, normal: weltNormale(tr), id } : null;
    },
    hover: (t) => hover.push(t?.guid ?? null),
    waehlen: (t) => gewaehlt.push(t?.guid ?? null),
    auswahlText: () => (gewaehlt.at(-1) ? "Wand · W1" : null),
    box: () => ({ min: [-3, 0, -0.12], max: [3, 3, 0.12] }),
  };
  const sprechen = { gestartet: 0, gestoppt: 0, verworfen: 0, bild: /** @type {boolean[]} */ ([]), aktionen: /** @type {string[]} */ ([]),
    starten() { this.gestartet++; }, stoppen() { this.gestoppt++; }, verwerfen() { this.verworfen++; },
    stand: () => ({ zustand: "bereit", gehoert: "", antwort: null, halt: null, rueckfrage: null, cloud: null }),
    aktion(id) { this.aktionen.push(id); }, bildSperren(an) { this.bild.push(an); } };
  return { f, reg, befehle, aufrufe, quelle, hover, gewaehlt, sprechen, mesh };
}

/** WebXR stand-in: navigator.xr, a session with events, a renderer.xr with three's controller groups. */
function attrappe({ lokalFloor = true, startFehler = null, setFehler = null } = {}) {
  /** @type {Record<string, Function[]>} */
  const hoerer = {};
  const session = {
    beendet: false,
    addEventListener: (typ, fn) => { (hoerer[typ] ??= []).push(fn); },
    removeEventListener: (typ, fn) => { hoerer[typ] = (hoerer[typ] ?? []).filter((x) => x !== fn); },
    requestReferenceSpace: async (typ) => { if (typ === "local-floor" && !lokalFloor) throw Object.assign(new Error("nein"), { name: "NotSupportedError" }); return { typ }; },
    end: async () => { session.beendet = true; for (const fn of hoerer.end ?? []) fn({}); },
  };
  /** @type {any[]} */
  const anfragen = [];
  const xr = { requestSession: async (modus, o) => { anfragen.push([modus, o]); if (startFehler) throw startFehler; return session; } };
  const controller = [new THREE.Group(), new THREE.Group()];
  controller.forEach((c) => { c.visible = false; });
  const renderer = {
    schleife: /** @type {any} */ (null), gerendert: 0, schleifenAufrufe: /** @type {any[]} */ ([]),
    xr: { enabled: false, isPresenting: false, typ: "", getController: (i) => controller[i],
      setReferenceSpaceType(t) { this.typ = t; },
      async setSession(s) { if (setFehler) throw setFehler; this.session = s; this.isPresenting = true; } },
    setAnimationLoop(fn) { this.schleife = fn; this.schleifenAufrufe.push(fn); },
    render() { this.gerendert++; },
  };
  /** @type {any[]} */
  const gezeichnet = [];
  const leinwand = () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: (_o, k) => (k === "fillText" ? (...a) => gezeichnet.push(a[0]) : typeof k === "string" && /^(fill|stroke|set)/.test(k) && !k.endsWith("Style") ? () => {} : undefined), set: () => true }) });
  /** Points a controller (reference space, m) at a target and sets its buttons, as the device would. */
  const pose = (i, von, nach) => {
    const c = controller[i];
    c.visible = true;
    c.position.set(...von);
    const d = new THREE.Vector3(...nach).sub(new THREE.Vector3(...von)).normalize();
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), d);
  };
  const tasten = (gedrueckt = [], achsen = [0, 0, 0, 0]) => ({ buttons: [0, 1, 2, 3, 4, 5].map((i) => ({ pressed: gedrueckt.includes(i) })), axes: achsen });
  let zeit = 0;
  const frame = () => { zeit += 16; renderer.schleife?.(zeit, {}); };
  return { xr, session, renderer, controller, leinwand, gezeichnet, pose, tasten, frame, anfragen, hoerer };
}

async function starte(o = {}) {
  const v = viewer(o);
  const a = attrappe(o);
  const szene = new THREE.Scene();
  szene.add(v.mesh);
  const kamera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 5000);
  kamera.position.set(9, 8, 7);
  const ende = [];
  // a clock that never moves: no pick is ever throttled by the time budget here (the budget has its own test)
  const s = await xrSitzung({
    renderer: a.renderer, szene, kamera, xr: a.xr, modus: o.modus ?? "1:1", quelle: o.quelle ?? v.quelle, sprechen: () => v.sprechen, befehle: v.befehle,
    darfAendern: () => v.f.darf, leinwand: a.leinwand, onEnde: (x) => ende.push(x), jetztMs: () => 0,
  });
  // three writes the device's head pose into the camera every frame (rig-local = reference space); the stand-in does it once
  kamera.position.set(0, 1.6, 0);
  return { v, a, s, szene, kamera, ende };
}

describe("106-08 Sitzung gegen die WebXR-Attrappe: Pose -> Treffer -> Auswahl -> Vorschlag -> Übernehmen", () => {
  it("Start: immersive-vr mit local-floor und Hand-Tracking optional, Schleife über setAnimationLoop, Kamera im Rig, kein Bild aus VR", async () => {
    const { a, s, kamera, v } = await starte();
    assert.deepEqual(a.anfragen, [["immersive-vr", { optionalFeatures: ["local-floor", "hand-tracking"] }]]);
    assert.equal(a.renderer.xr.enabled, true);
    assert.equal(a.renderer.xr.typ, "local-floor");
    assert.equal(s.referenzraum, "local-floor");
    assert.equal(typeof a.renderer.schleife, "function");
    assert.equal(kamera.parent?.name, "xr-rig");
    assert.deepEqual(v.sprechen.bild, [true], "während VR geht kein Bild der Ansicht mit einem Satz");
    a.frame();
    assert.equal(a.renderer.gerendert, 1, "die Sitzung rendert selbst");
  });

  it("Controller zeigt auf die Wand: Hover mit GUID; Abzug wählt; ins Leere hebt auf; Laser sichtbar", async () => {
    const { a, s, v } = await starte();
    a.controller[0].dispatchEvent({ type: "connected", data: { targetRayMode: "tracked-pointer", handedness: "right", gamepad: a.tasten() } });
    // 1:1: the person stands 3 m before the wall's front face (z = 0.12 + 3): straight ahead at 1.4 m height
    a.pose(0, [0, 1.4, 0], [0, 1.4, -1]);
    a.frame();
    assert.deepEqual(v.hover, [GUID]);
    assert.equal(s.steuerung.zustand().letzte.ergebnisse[0].ziel, "bauteil");
    const laser = a.controller[0].children.find((c) => c.name === "xr-laser-voll");
    assert.ok(laser?.visible && Math.abs(laser.scale.z - 3) < 1e-6, `Laser bis zur Wand (3 m), war ${laser?.scale.z}`);
    a.controller[0].dispatchEvent({ type: "connected", data: { targetRayMode: "tracked-pointer", handedness: "right", gamepad: a.tasten([0]) } });
    a.frame();
    assert.deepEqual(v.gewaehlt, [GUID], "Abzug = Klick: die GUID aus dem Strahl");
    a.controller[0].dispatchEvent({ type: "connected", data: { targetRayMode: "tracked-pointer", handedness: "right", gamepad: a.tasten() } });
    a.pose(0, [0, 1.4, 0], [0, 3, -1]); // over the wall into the sky
    a.frame();
    assert.equal(v.hover.at(-1), null, "kein Treffer, kein Hover");
    const leer = a.controller[0].children.find((c) => c.name === "xr-laser-leer");
    assert.ok(leer?.visible, "gestrichelter Laser ins Leere");
    a.controller[0].dispatchEvent({ type: "connected", data: { targetRayMode: "tracked-pointer", handedness: "right", gamepad: a.tasten([0]) } });
    a.frame();
    assert.equal(v.gewaehlt.at(-1), null, "Abzug ins Leere hebt die Auswahl auf wie ein Klick");
  });

  it("Blickstrahl (gaze) wird nicht benutzt (D-IM-06); eine Hand wählt per Pinch (select-Ereignis)", async () => {
    const { a, s, v } = await starte();
    a.controller[1].dispatchEvent({ type: "connected", data: { targetRayMode: "gaze", gamepad: null } });
    a.pose(1, [0, 1.4, 0], [0, 1.4, -1]);
    a.frame();
    assert.deepEqual(v.hover, [], "kein Hover über den Blick");
    assert.deepEqual(s.steuerung.zustand().letzte.ergebnisse, []);
    a.controller[0].dispatchEvent({ type: "connected", data: { targetRayMode: "tracked-pointer", hand: {}, gamepad: null } });
    a.pose(0, [0, 1.4, 0], [0, 1.4, -1]);
    a.frame();
    a.controller[0].dispatchEvent({ type: "selectstart" });
    a.frame();
    a.controller[0].dispatchEvent({ type: "selectend" });
    a.frame();
    assert.deepEqual(v.gewaehlt, [GUID]);
  });

  it("Griff = Sprech-Knopf halten (106-05); Loslassen sendet; verlorener Controller beendet die Aufnahme", async () => {
    const { a, v } = await starte();
    const verbinden = (g) => a.controller[0].dispatchEvent({ type: "connected", data: { targetRayMode: "tracked-pointer", gamepad: g } });
    verbinden(a.tasten());
    a.pose(0, [0, 1.4, 0], [0, 1.4, -1]);
    a.frame();
    verbinden(a.tasten([1]));
    a.frame();
    assert.equal(v.sprechen.gestartet, 1);
    verbinden(a.tasten());
    a.frame();
    assert.equal(v.sprechen.gestoppt, 1);
    verbinden(a.tasten([1]));
    a.frame();
    a.controller[0].dispatchEvent({ type: "disconnected" });
    a.frame();
    assert.equal(v.sprechen.gestoppt, 2, "nie ein offenes Mikrofon");
  });

  it("Vorschlag auf der Tafel; Übernehmen per Strahl auf den Knopf + Abzug = bestaetigen durch „hand“ (D-IM-04)", async () => {
    const { a, s, v } = await starte();
    const verbinden = (g) => a.controller[0].dispatchEvent({ type: "connected", data: { targetRayMode: "tracked-pointer", gamepad: g } });
    verbinden(a.tasten());
    a.pose(0, [0, 1.4, 0], [0, 1.4, -1]);
    a.frame();
    const vorschlag = v.reg.ausfuehren("eigenschaft-setzen", { guid: GUID, name: "feuerwiderstand", wert: "F90" }, {});
    assert.equal(vorschlag.ok, true, JSON.stringify(vorschlag));
    a.frame();
    const tafel = s.tafel();
    assert.ok(tafel.zeilen.some((z) => z.text.includes("F90")), "der Satz steht auf der Tafel, bevor etwas passiert");
    assert.equal(v.f.angewendet, 0);
    assert.ok(a.gezeichnet.some((x) => String(x).startsWith("Übernehmen")), "auf die Leinwand gezeichnet");
    const ziel = s.knopfMitteReferenz("uebernehmen");
    assert.ok(ziel);
    a.pose(0, [ziel[0] + 0.1, ziel[1] + 0.05, ziel[2] + 0.4], ziel);
    a.frame();
    assert.equal(s.steuerung.zustand().letzte.ergebnisse[0].knopf, "uebernehmen", "der Strahl liegt auf dem Knopf");
    assert.equal(v.gewaehlt.length, 0, "ein Strahl auf der Tafel wählt nichts dahinter");
    verbinden(a.tasten([0]));
    a.frame();
    assert.equal(v.f.angewendet, 1);
    assert.equal(v.f.modell.customWalls[0].feuerwiderstand, "F90");
    const verlauf = v.reg.ausfuehren("vorschlaege", {}).result.verlauf;
    assert.equal(verlauf.at(-1).bestaetigt_durch, "hand");
    assert.ok(new Set(v.aufrufe).size <= 3 && v.aufrufe.every((id) => ["vorschlaege", "bestaetigen", "verwerfen"].includes(id)),
      `VR ruft nur lesen/bestätigen/verwerfen: ${[...new Set(v.aufrufe)]}`);
  });

  it("ohne Recht (106-07): Übernehmen auf der Tafel aus, Taste A wird vom Register verweigert, nichts geändert; Verwerfen geht", async () => {
    const { a, s, v } = await starte({ darf: false });
    const verbinden = (g) => a.controller[0].dispatchEvent({ type: "connected", data: { targetRayMode: "tracked-pointer", gamepad: g } });
    verbinden(a.tasten());
    a.pose(0, [0, 1.4, 0], [0, 1.4, -1]);
    v.reg.ausfuehren("eigenschaft-setzen", { guid: GUID, name: "feuerwiderstand", wert: "F90" }, {});
    a.frame();
    assert.equal(s.tafel().knoepfe.find((k) => k.id === "uebernehmen")?.aktiv, false);
    const ziel = s.knopfMitteReferenz("uebernehmen");
    a.pose(0, [ziel[0], ziel[1], ziel[2] + 0.4], ziel);
    a.frame();
    assert.equal(s.steuerung.zustand().letzte.ergebnisse[0].knopf, null, "ein gesperrter Knopf ist kein Ziel");
    verbinden(a.tasten([0]));
    a.frame();
    verbinden(a.tasten());
    a.frame();
    verbinden(a.tasten([4])); // face button A
    a.frame();
    assert.equal(v.f.angewendet, 0);
    assert.equal(s.steuerung.zustand().letzte.stand.meldung.text, KEIN_AENDERUNGSRECHT_TEXT);
    verbinden(a.tasten([5])); // B
    a.frame();
    assert.equal(v.f.speicher.offen().length, 0, "verwerfen ändert nichts und bleibt offen");
  });

  it("Tischmodell, Maßstab-Knopf, Teleport nur 1:1, Stick dreht in 30°-Schritten", async () => {
    const { a, s } = await starte({ modus: "tisch" });
    assert.equal(s.steuerung.zustand().rig.massstab, 6, "6 m Wand erscheint 1 m breit");
    const verbinden = (g) => a.controller[0].dispatchEvent({ type: "connected", data: { targetRayMode: "tracked-pointer", gamepad: g } });
    verbinden(a.tasten());
    a.pose(0, [0, 1.2, 0], [0, 0, -1]);
    a.frame();
    verbinden(a.tasten([3]));
    a.frame();
    assert.match(s.steuerung.zustand().letzte.stand.meldung.text, /Teleport nur im Maßstab 1:1/);
    s.steuerung.aktion("massstab");
    assert.equal(s.modus(), "1:1");
    assert.equal(s.steuerung.zustand().rig.massstab, 1);
    verbinden(a.tasten());
    a.frame();
    const vorher = s.steuerung.zustand().rig;
    a.pose(0, [0, 1.6, 0], [0, 0, -1.6]); // down onto the floor 1.6 m ahead
    verbinden(a.tasten([3]));
    a.frame();
    const nachher = s.steuerung.zustand().rig;
    assert.ok(Math.abs(nachher.z - (vorher.z - 1.6)) < 1e-6, `Teleport 1,6 m nach vorn: ${vorher.z} -> ${nachher.z}`);
    verbinden(a.tasten([], [0, 0, 0.9, 0]));
    a.frame();
    verbinden(a.tasten([], [0, 0, 0.9, 0]));
    a.frame();
    assert.ok(Math.abs(s.steuerung.zustand().rig.drehungRad + DREH_SCHRITT_RAD) < 1e-9, "ein Schritt je Auslenkung (nach rechts)");
  });

  it("Ende: Kamera zurück, Schleife aus, Rig weg, Bild wieder frei, onEnde; local ohne Boden: Augenhöhe", async () => {
    const { a, kamera, szene, v, ende } = await starte();
    await a.session.end();
    assert.equal(kamera.parent, null);
    assert.ok(nah(kamera.position.toArray(), [9, 8, 7]), "die Desktop-Pose kommt zurück, nicht die des Geräts");
    assert.equal(a.renderer.schleifenAufrufe.at(-1), null);
    assert.equal(a.renderer.xr.enabled, false);
    assert.equal(szene.getObjectByName("xr-rig"), undefined);
    assert.equal(szene.getObjectByName("xr-marke"), undefined);
    assert.deepEqual(v.sprechen.bild, [true, false]);
    assert.equal(ende.length, 1);
    const lokal = await starte({ lokalFloor: false });
    assert.equal(lokal.s.referenzraum, "local");
    assert.equal(lokal.a.renderer.xr.typ, "local");
  });

  it("Startfehler: Klartext, nichts bleibt in der Szene", async () => {
    await assert.rejects(starte({ startFehler: Object.assign(new Error("denied"), { name: "NotAllowedError" }) }),
      (e) => /** @type {Error} */ (e).message.startsWith(XR_GRUENDE.nichtErlaubt));
    const v = viewer();
    const a = attrappe({ setFehler: Object.assign(new Error("gl"), { name: "InvalidStateError" }) });
    const szene = new THREE.Scene();
    const kamera = new THREE.PerspectiveCamera();
    await assert.rejects(xrSitzung({ renderer: a.renderer, szene, kamera, xr: a.xr, quelle: v.quelle, sprechen: () => v.sprechen, befehle: v.befehle, darfAendern: () => true, leinwand: a.leinwand }),
      (e) => /** @type {Error} */ (e).message.startsWith(XR_GRUENDE.laeuftSchon));
    assert.equal(szene.getObjectByName("xr-rig"), undefined);
    assert.equal(kamera.parent, null);
    assert.equal(a.session.beendet, true);
  });

  it("xrSteuerung allein: Tafel-Knöpfe für Rückfrage und Abbrechen gehen an das Sprechfeld", () => {
    const v = viewer();
    const st = xrSteuerung({ quelle: v.quelle, sprechen: () => v.sprechen, befehle: v.befehle, darfAendern: () => true, rig: rigFuerModus("1:1", null), modus: "1:1" });
    st.aktion("rueckfrage-ja");
    st.aktion("abbrechen");
    assert.deepEqual(v.sprechen.aktionen, ["rueckfrage-ja", "abbrechen"]);
    assert.equal(st.aktion("uebernehmen").ok, false, "ohne offenen Vorschlag nichts zu übernehmen");
  });
});

// ---- review 106-08: the findings, each as a test ----
describe("106-08 Review: Tafel-Layout behält Satz und Fragen, Knöpfe nur mit ihrer Zeile, kein Text über den Knöpfen", () => {
  const saetze = (n) => Array.from({ length: n }, (_, i) => `Achtung Satz ${i + 1}: die Wand trägt die Decke darüber, eine Änderung braucht die Statik.`);
  const vor = (o = {}) => ({ id: "v1", satz: "Wand 1: Feuerwiderstand F30 → F90 im zweiten Obergeschoss an der Achse B, mit Schallschutz nach der Tabelle", pruefung: { stufe: "warn", saetze: saetze(3) }, herkunft: "sprache", herkunft_quellen: ["sprache"], ...o });
  /** Invariants: an active button tied to a line has that line on the panel; the last line ends one gap above the first button row. */
  const pruefen = (stand) => {
    const inhalt = tafelInhalt(stand);
    const l = tafelLayout(inhalt);
    for (const z of inhalt.zeilen) {
      const da = l.zeilen.some((x) => x.text === z.text);
      for (const id of z.knoepfe ?? []) {
        if (l.knoepfe.find((k) => k.id === id)?.aktiv) assert.ok(da, `Knopf ${id} aktiv, aber seine Zeile fehlt: ${z.text}`);
        if (!da) assert.ok(l.weg.includes(id), `Zeile weg, Knopf ${id} nicht abgeschaltet`);
      }
    }
    const knopfOben = Math.min(...l.knoepfe.map((k) => k.y));
    const letzte = l.zeilen.at(-1);
    if (letzte) assert.ok(letzte.y + letzte.teile.length * 36 <= knopfOben - 14, `Text läuft in die Knöpfe: ${letzte.y + letzte.teile.length * 36} > ${knopfOben - 14}`);
    return l;
  };

  it("Rückfrage + Cloud-Frage + Warnung mit 3 Sätzen: Satz, Prüfung und beide Fragen bleiben, alle Knöpfe aktiv", () => {
    const l = pruefen({ zeigt: "Wand · W1", auswahl: "Wand · W1", sprechen: { zustand: "bereit", gehoert: "setze Brandschutz auf F90 und prüfe den Schallschutz", rueckfrage: "Soll ich den Schritt an Wand 1 zurücknehmen?", cloud: { anbieter: "fern" }, antwort: { text: "Verstanden, ein Vorschlag steht bereit", stufe: "frage" } }, vorschlag: vor(), offenAnzahl: 2, darfAendern: true, meldung: { text: "Verworfen: Wand 2", ok: true }, modus: "1:1" });
    assert.ok(l.zeilen.some((z) => z.art === "titel" && z.text.includes("F90")), "der vorgeschlagene Satz steht da");
    assert.ok(l.zeilen.some((z) => z.art === "warnung" && z.text.startsWith("▲")), "die Prüfung steht da");
    assert.ok(l.zeilen.some((z) => z.text.startsWith("? Soll ich")), "die Rückfrage steht da");
    assert.ok(l.zeilen.some((z) => z.text.includes("außerhalb dieses Rechners")), "die Cloud-Frage steht da");
    assert.deepEqual(l.weg, []);
    for (const id of ["uebernehmen", "verwerfen", "rueckfrage-ja", "rueckfrage-nein", "cloud-ja", "cloud-nein"]) assert.equal(l.knoepfe.find((k) => k.id === id)?.aktiv, true, id);
  });

  it("6 lange Warnsätze: die Warnung wird auf 3 Zeilen gekürzt (…), der Satz der Änderung bleibt, Übernehmen aktiv", () => {
    const l = pruefen({ zeigt: "Wand · W1", auswahl: "Wand · W1", sprechen: { zustand: "bereit", rueckfrage: "Soll ich?", cloud: { anbieter: "fern" } }, vorschlag: vor({ pruefung: { stufe: "warn", saetze: saetze(6) } }), offenAnzahl: 1, darfAendern: true, modus: "1:1" });
    const warn = l.zeilen.find((z) => z.art === "warnung");
    assert.ok(warn && warn.teile.length === 3 && warn.teile[2].endsWith("…"), `Warnung gekürzt: ${JSON.stringify(warn?.teile)}`);
    assert.ok(l.zeilen.some((z) => z.art === "titel"));
    assert.equal(l.knoepfe.find((k) => k.id === "uebernehmen")?.aktiv, true);
  });

  it("Platz reicht nicht für alle festen Zeilen: die lange Rückfrage geht, ihre Knöpfe werden abgeschaltet; der Satz der Änderung bleibt", () => {
    const lang = (n) => Array.from({ length: n }, (_, i) => `Wort${i}`).join(" ");
    const l = pruefen({ sprechen: { zustand: "bereit", halt: { was: "F90" }, rueckfrage: `Soll ich ${lang(60)}?`, cloud: { anbieter: "fern" } }, vorschlag: vor({ satz: lang(30) }), offenAnzahl: 1, darfAendern: true, modus: "1:1" });
    assert.ok(l.zeilen.some((z) => z.art === "titel"), "der Satz der Änderung steht da");
    assert.equal(l.knoepfe.find((k) => k.id === "uebernehmen")?.aktiv, true);
    assert.deepEqual(l.weg, ["rueckfrage-ja", "rueckfrage-nein"], "die lange Rückfrage ging, ihre Knöpfe sind aus");
    assert.ok(l.zeilen.some((z) => z.text.includes("außerhalb dieses Rechners")), "die kurze Cloud-Frage passt danach wieder hin");
    assert.equal(l.knoepfe.find((k) => k.id === "cloud-ja")?.aktiv, true);
    assert.equal(l.knoepfe.find((k) => k.id === "abbrechen")?.aktiv, true, "Abbrechen ändert nichts und bleibt immer bedienbar");
  });

  it("passt selbst der Satz der Änderung nicht: Übernehmen und Verwerfen aus — nie ein Knopf ohne den Satz", () => {
    const lang = Array.from({ length: 200 }, (_, i) => `Wort${i}`).join(" ");
    const l = pruefen({ vorschlag: vor({ satz: lang }), offenAnzahl: 1, darfAendern: true, modus: "1:1" });
    assert.equal(l.zeilen.some((z) => z.art === "titel"), false);
    assert.equal(l.knoepfe.find((k) => k.id === "uebernehmen")?.aktiv, false);
    assert.equal(l.knoepfe.find((k) => k.id === "verwerfen")?.aktiv, false);
  });

  it("volle Tafel ohne Fragen: ältere Sprechzeilen gehen vor der Auswahl; die letzte Zeile endet über den Knöpfen", () => {
    const l = pruefen({ zeigt: "Wand · W1", auswahl: "Wand · W1 im zweiten Obergeschoss", sprechen: { zustand: "aufnahme", gehoert: `setze ${"Brandschutz ".repeat(10)}auf F90`, antwort: { text: `Nicht verstanden ${"bitte noch einmal ".repeat(8)}`, stufe: "hinweis" } }, vorschlag: vor(), offenAnzahl: 1, darfAendern: false, meldung: { text: "Nur ansehen und vorschlagen — keine Rechte für eine Änderung am Modell, bitte die Projektleitung fragen", ok: false }, modus: "1:1" });
    assert.ok(l.zeilen.some((z) => z.text.startsWith("Ausgewählt:")), "die Auswahl bleibt");
    assert.ok(l.zeilen.some((z) => z.art === "aufnahme"), "ein offenes Mikrofon wird immer gesagt");
    assert.equal(l.zeilen.some((z) => z.text.startsWith("Gehört:")), false, "das ältere Gehörte ging zuerst");
  });
});

describe("106-08 Review: Bestätigen nur für den gezeigten Vorschlag, Schleife nur mit XRFrame, Kamera, Bild, Pick-Budget, Teleport, Aufbau", () => {
  const verbinder = (a) => (g) => a.controller[0].dispatchEvent({ type: "connected", data: { targetRayMode: "tracked-pointer", gamepad: g } });

  it("ein Vorschlag, der nach dem Zeichnen der Tafel kommt, wird mit A NICHT übernommen; erst der neu gezeigte", async () => {
    const { a, s, v } = await starte();
    const verbinden = verbinder(a);
    verbinden(a.tasten());
    a.pose(0, [0, 1.4, 0], [0, 1.4, -1]);
    a.frame();
    assert.equal(v.reg.ausfuehren("eigenschaft-setzen", { guid: GUID, name: "feuerwiderstand", wert: "F90" }, {}).ok, true);
    a.frame();
    assert.ok(s.tafel().zeilen.some((z) => z.text.includes("F90")), "die Tafel zeigt F90");
    // an agent proposes something else between two frames - the panel still shows F90
    assert.equal(v.reg.ausfuehren("eigenschaft-setzen", { guid: GUID, name: "feuerwiderstand", wert: "F120" }, {}).ok, true);
    verbinden(a.tasten([4])); // A
    a.frame();
    assert.equal(v.f.angewendet, 0, "nichts übernommen, was nie in Worten zu sehen war");
    assert.equal(s.steuerung.zustand().letzte.stand.meldung.text, "Vorschlag hat sich geändert — bitte neu ansehen");
    assert.ok(s.tafel().zeilen.some((z) => z.text.includes("F120")), "jetzt zeigt die Tafel den neuen Vorschlag");
    verbinden(a.tasten());
    a.frame();
    verbinden(a.tasten([4]));
    a.frame();
    assert.equal(v.f.angewendet, 1);
    assert.equal(v.f.modell.customWalls[0].feuerwiderstand, "F120", "übernommen wird genau der gezeigte");
  });

  it("die Schleife arbeitet nur mit XRFrame: ein Aufruf aus three's Fenster-Schleife pickt und rendert nicht; gesetzt vor setSession", async () => {
    const v = viewer();
    const a = attrappe();
    /** @type {boolean[]} */
    const zeigteBeimSetzen = [];
    const setzen = a.renderer.setAnimationLoop.bind(a.renderer);
    a.renderer.setAnimationLoop = (fn) => { if (fn) zeigteBeimSetzen.push(a.renderer.xr.isPresenting); setzen(fn); };
    const szene = new THREE.Scene();
    szene.add(v.mesh);
    const kamera = new THREE.PerspectiveCamera();
    await xrSitzung({ renderer: a.renderer, szene, kamera, xr: a.xr, quelle: v.quelle, sprechen: () => v.sprechen, befehle: v.befehle, darfAendern: () => true, leinwand: a.leinwand, jetztMs: () => 0 });
    kamera.position.set(0, 1.6, 0);
    assert.deepEqual(zeigteBeimSetzen, [false], "vor setSession gesetzt: three's 'sessionstart' hält seine Fenster-Schleife an");
    a.controller[0].dispatchEvent({ type: "connected", data: { targetRayMode: "tracked-pointer", gamepad: a.tasten() } });
    a.pose(0, [0, 1.4, 0], [0, 1.4, -1]);
    a.renderer.schleife?.(16); // three's window loop: (time) without a frame
    assert.equal(a.renderer.gerendert, 0, "kein zweites Rendern außerhalb des XR-Frames");
    assert.deepEqual(v.hover, [], "kein Pick außerhalb des XR-Frames");
    a.frame();
    assert.equal(a.renderer.gerendert, 1);
    assert.deepEqual(v.hover, [GUID]);
  });

  it("Ende: die Desktop-Kamera bekommt ihr Sichtfeld zurück, nicht das der Brille (three schreibt fov/zoom in jedem XR-Frame)", async () => {
    const { a, kamera } = await starte();
    // what three's WebXRManager.updateUserCamera does to the user camera every XR frame
    kamera.fov = 90; kamera.zoom = 1; kamera.near = 0.05; kamera.far = 100; kamera.aspect = 1;
    kamera.projectionMatrix.identity();
    await a.session.end();
    assert.deepEqual([kamera.fov, kamera.zoom, kamera.near, kamera.far, kamera.aspect], [50, 1, 0.1, 5000, 1.5]);
    const vorher = new THREE.PerspectiveCamera(50, 1.5, 0.1, 5000);
    assert.ok(nah(kamera.projectionMatrix.elements, vorher.projectionMatrix.elements, 1e-9), "Projektionsmatrix wie vorher");
  });

  it("kein Bild der Ansicht, solange die Brille zeigt: ansichtAlsPng liest den Renderer (MCP ansicht_bild und Sprechfeld)", () => {
    const three = { renderer: { xr: { isPresenting: true }, domElement: { width: 10, height: 10 }, render() { throw new Error("darf nicht rendern"); } }, scene: {}, camera: {} };
    assert.equal(xrZeigtGerade(three), true);
    assert.throws(() => ansichtAlsPng(three), (e) => /** @type {Error} */ (e).message === XR_KEIN_BILD_TEXT);
    three.renderer.xr.isPresenting = false;
    assert.equal(xrZeigtGerade(three), false);
    assert.equal(xrZeigtGerade(null), false);
  });

  it("Pick-Budget: ein ruhiger Strahl nutzt seinen letzten Treffer, ein langsamer Pick streckt den nächsten, ein Abzug pickt immer neu", () => {
    const v = viewer();
    let n = 0;
    let uhr = 0;
    const quelle = { ...v.quelle, treffen: (s) => { n += 1; uhr += 30; return v.quelle.treffen(s); } }; // each pick costs 30 ms (> 8 ms budget)
    const st = xrSteuerung({ quelle, sprechen: () => v.sprechen, befehle: v.befehle, darfAendern: () => true, rig: rigFuerModus("1:1", quelle.box()), modus: "1:1", jetztMs: () => uhr });
    const ruhe = { trigger: false, griff: false, stick: false, a: false, b: false };
    const ein = (richtung, tasten = ruhe) => [{ index: 0, strahl: { ursprung: [0, 1.4, 3.12], richtung }, tasten, achsen: /** @type {[number, number]} */ ([0, 0]) }];
    st.schritt(ein([0, 0, -1]), 0.016);
    assert.equal(n, 1);
    for (let i = 0; i < 5; i++) st.schritt(ein([0, 0, -1]), 0.016);
    assert.equal(n, 1, "ruhiger Strahl: kein neuer Pick");
    const d = new THREE.Vector3(0.1, 0, -1).normalize().toArray();
    st.schritt(ein(d), 0.016);
    assert.equal(n, 1, "der langsame Pick streckt den nächsten (Budget wie der Desktop-Hover)");
    uhr += 100;
    st.schritt(ein(d), 0.016);
    assert.equal(n, 2);
    st.schritt(ein(d, { ...ruhe, trigger: true }), 0.016);
    assert.equal(n, 3, "der Abzug wählt mit einem frischen Pick");
    assert.deepEqual(v.gewaehlt, [GUID]);
  });

  it("Teleport: ein roher Treffer ohne Bauteil (Kontextgebäude, unbekanntes IFC-Teil) blockiert wie eine Wand", () => {
    const v = viewer();
    const roh = { ...v.quelle, treffen: () => null, rohTreffen: () => ({ punkt: [0, 1, -1], abstand: 1.2, normal: [0, 0, 1] }) };
    const st = xrSteuerung({ quelle: roh, sprechen: () => v.sprechen, befehle: v.befehle, darfAendern: () => true, rig: rigFuerModus("1:1", null), modus: "1:1", jetztMs: () => 0 });
    const vorher = st.zustand().rig;
    const r = Math.SQRT1_2;
    st.schritt([{ index: 0, strahl: { ursprung: [0, 1.6, 7], richtung: [0, -r, -r] }, tasten: { trigger: false, griff: false, stick: true, a: false, b: false }, achsen: [0, 0] }], 0.016);
    assert.deepEqual(st.zustand().rig, vorher, "nicht durch die Wand");
    assert.match(st.zustand().letzte.stand.meldung.text, /Kein Boden/);
    // without the raw hit the same ray would land on the floor
    const leer = xrSteuerung({ quelle: { ...roh, rohTreffen: () => null }, sprechen: () => v.sprechen, befehle: v.befehle, darfAendern: () => true, rig: rigFuerModus("1:1", null), modus: "1:1", jetztMs: () => 0 });
    leer.schritt([{ index: 0, strahl: { ursprung: [0, 1.6, 7], richtung: [0, -r, -r] }, tasten: { trigger: false, griff: false, stick: true, a: false, b: false }, achsen: [0, 0] }], 0.016);
    assert.notDeepEqual(leer.zustand().rig, vorher);
  });

  it("Tafel über Modell und Hervorhebungen (kein Tiefentest, höchste Reihenfolge); im Tischmodell über der üblichen Modellhöhe", async () => {
    const { a, s, szene } = await starte({ modus: "tisch" });
    const tafel = /** @type {any} */ (szene.getObjectByName("xr-tafel"));
    assert.equal(tafel.material.depthTest, false);
    assert.equal(tafel.material.transparent, true, "im letzten Durchgang sortiert, nach den transparenten Auswahl-Linien");
    assert.ok(tafel.renderOrder > 999, "über den Hervorhebungen (998/999)");
    const laser = a.controller[0].children.find((c) => c.name === "xr-laser-voll");
    assert.ok(laser && laser.renderOrder > tafel.renderOrder, "der Laser auf einen Knopf bleibt sichtbar");
    // a usual building (30 m wide, 10 m high) stands 0.33 m high on the 0.9 m table: the panel's lower edge is above it (user space)
    tafel.updateMatrix();
    const unten = Math.min(...[[-1, -1], [1, -1]].map(([x, y]) => new THREE.Vector3(x * 0.32, y * 0.22, 0).applyMatrix4(tafel.matrix).y));
    assert.ok(unten > 0.9 + 10 / 30, `Unterkante der Tafel ${unten.toFixed(2)} m über dem üblichen Tischmodell`);
    s.steuerung.aktion("massstab");
    assert.ok(Math.abs(tafel.position.y - 1.25) < 1e-9, "bei 1:1 wieder auf Armhöhe");
  });

  it("Tischmodell: kein Frustum-Culling (three's Vereinigungs-Kamera rechnet im skalierten Rig falsch), bei 1:1 und nach dem Ende wieder an", async () => {
    const { a, s, v } = await starte({ modus: "tisch" });
    a.frame();
    assert.equal(v.mesh.frustumCulled, false, "im Tischmodell wird nichts weggeschnitten");
    s.steuerung.aktion("massstab");
    a.frame();
    assert.equal(v.mesh.frustumCulled, true, "bei 1:1 stimmt three's Culling und bleibt an");
    s.steuerung.aktion("massstab");
    a.frame();
    assert.equal(v.mesh.frustumCulled, false);
    await a.session.end();
    assert.equal(v.mesh.frustumCulled, true, "nach dem Ende wie vorher");
  });

  it("Fehler im Aufbau nach der Zusage des Geräts (z. B. box()): die Sitzung wird beendet, nichts bleibt in der Szene", async () => {
    const v = viewer();
    const a = attrappe();
    const szene = new THREE.Scene();
    const kamera = new THREE.PerspectiveCamera();
    await assert.rejects(xrSitzung({ renderer: a.renderer, szene, kamera, xr: a.xr, quelle: { ...v.quelle, box: () => { throw new Error("Box kaputt"); } }, sprechen: () => v.sprechen, befehle: v.befehle, darfAendern: () => true, leinwand: a.leinwand }),
      (e) => /** @type {Error} */ (e).message.includes("Box kaputt"));
    assert.equal(a.session.beendet, true, "keine immersive Sitzung ohne Besitzer");
    assert.equal(szene.getObjectByName("xr-rig"), undefined);
    assert.equal(szene.getObjectByName("xr-marke"), undefined);
    assert.equal(kamera.parent, null);
    assert.equal(a.renderer.schleife, null);
  });
});
