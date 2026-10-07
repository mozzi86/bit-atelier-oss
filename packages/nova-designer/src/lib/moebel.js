// Möbelkatalog + Geometrie-Helfer für die Raum-Möblierung (Innenausbau + ASR-Draufsicht).
//
// 75-09: einziger Import ist accessibility.js (selbst import-frei ⇒ kein Zyklus) für die
// Bewegungsflächen-Tiefen der Stufen B/R. wohnMoebel.js importiert DIESE Datei, nie umgekehrt.
import { bewegungsflaeche } from "@designer/lib/accessibility";
//
// Datenmodell (persistiert in complexData):
//   complexData.moeblierung = { [zoneKey]: [{ id, typ, x, y, rot }] }
//     - zoneKey: seit Phase 43 `id:<zone.id>` für Räume aus dem BIM-Studio (zone.id = das
//       persistente _idx, in den Store gespiegelt) — überlebt das Umbenennen; für generierte
//       Räume (·W, ·WT) weiterhin der Legacy-Schlüssel `${level}:${name}` (= asr.roomKey).
//       Legacy-Einträge werden gelesen (moebelFuerZone) und beim Öffnen des Reiters auf den
//       id-Schlüssel gehoben (migriereMoeblierung).
//   complexData.moebel_eigene = [{ id: "eigen-…", name, b, t, kategorie, benutzerseite }]
//     - eigene Möbeltypen des Projekts; über setzeEigeneTypen() im Register, damit moebelById
//       und alle Geometrie-Helfer sie wie Katalogtypen behandeln.
//     - id:  eindeutige Instanz-Id (String)
//     - typ: Katalog-Typ-Id (siehe MOEBEL_KATALOG)
//     - x/y: Mittelpunkt in Metern im Koordinatensystem der Zone-Points
//            (y entspricht points[].z — die Zone führt x/z, wir nennen die
//            zweite Achse hier y, gerendert wird sie auf die SVG-y-Achse)
//     - rot: Rotation 0 | 90 | 180 | 270 (Grad, im Uhrzeigersinn)
//
// Kategorien (Farben nach Realprojekt-Vorlage):
//   desk  → #9ec5ff / #0f62fe   chair → #e6edf3 / #afb8c1
//   furn  → #d8dee4 / #8b949e   sanitaer → wie furn, dunkelgrau
//
// benutzerseite: true ⇒ vor der Längsseite (Benutzerseite) ist eine 1,00 m tiefe
// Bewegungsfläche freizuhalten (ASR A1.2) — grün gestrichelt dargestellt.
//
// Wohn-Gruppe (75-09, Blatt 07 — Lösungskatalog Massing-Studio, Textextrakt
// `.planning/quellen/massing-studio/2026-09-20_…_textextrakt.md:183-193`):
// `WOHN_GRUPPE` ist eine EIGENE Konstante neben `MOEBEL_KATALOG` (der Katalog bleibt
// 5 Gruppen / 15 Typen — gepinnt durch tests/unit/moebel.test.js:49-53); `BY_ID` kennt
// beide, damit moebelById/itemRect/alle Renderer die Wohn-Typen verstehen.
// Zusätzliche Typ-Felder der Wohn-Gruppe (alle optional, BestandsTypen ohne sie):
//   bewegung.seiten = [{ seite: "vorn"|"hinten"|"links"|"rechts",
//                        rolle: "haupt"|"fest", standard }]   — Tiefen in METERN.
//     Seiten gelten im Item-Rahmen bei rot 0 (vorn = +y wie die Benutzerseite,
//     links = −x); beim Bett ist „hinten" das Kopfende.
//     rolle "haupt" ⇒ Stufe B/R übernimmt accessibility.bewegungsflaeche (1,20 / 1,50 m,
//     DIN 18040-2), rolle "fest" ⇒ in ALLEN Stufen der Blatt-07-Standardwert.
//   tuer = { lichte_m }   — lichte Durchgangsbreite in METERN (b des Typs = Rohbaumaß, D-P75-09-A).
//   regeln = ["nicht_vor_fenster"|"in_bewegungsflaeche_ok"]   — see wohnMoebel.js.
// Zusäzliches Item-Feld (nur Türen): `aufschlag: "links"|"rechts"` (Default "links").

// [ASSUMED] Alle Maße (b = Breite entlang der Benutzerseite, t = Tiefe) sind
// gängige Richtwerte in Metern, keine Herstellerangaben.
export const MOEBEL_KATALOG = [
  {
    gruppe: "Arbeitsplatz",
    typen: [
      { id: "schreibtisch", name: "Schreibtisch", b: 1.6, t: 0.8, kategorie: "desk", benutzerseite: true },
      { id: "buerostuhl", name: "Bürostuhl", b: 0.5, t: 0.5, kategorie: "chair", benutzerseite: false },
      { id: "rollcontainer", name: "Rollcontainer", b: 0.45, t: 0.6, kategorie: "furn", benutzerseite: false },
      { id: "doppeltisch", name: "Bildschirm-Doppeltisch", b: 1.8, t: 1.6, kategorie: "desk", benutzerseite: true },
    ],
  },
  {
    gruppe: "Besprechung",
    typen: [
      { id: "besprechungstisch", name: "Besprechungstisch", b: 2.0, t: 1.0, kategorie: "desk", benutzerseite: true },
      { id: "stuhl", name: "Stuhl", b: 0.45, t: 0.45, kategorie: "chair", benutzerseite: false },
    ],
  },
  {
    gruppe: "Schränke / Lager",
    typen: [
      { id: "aktenschrank", name: "Aktenschrank", b: 0.8, t: 0.42, kategorie: "furn", benutzerseite: true },
      { id: "regal", name: "Regal", b: 1.0, t: 0.4, kategorie: "furn", benutzerseite: true },
      { id: "garderobe", name: "Garderobe", b: 0.6, t: 0.5, kategorie: "furn", benutzerseite: false },
    ],
  },
  {
    gruppe: "Sanitär",
    typen: [
      { id: "wc_becken", name: "WC-Becken", b: 0.4, t: 0.6, kategorie: "sanitaer", benutzerseite: true },
      { id: "waschtisch", name: "Waschtisch", b: 0.6, t: 0.55, kategorie: "sanitaer", benutzerseite: true },
      { id: "urinal", name: "Urinal", b: 0.4, t: 0.4, kategorie: "sanitaer", benutzerseite: false },
    ],
  },
  {
    gruppe: "Sozial",
    typen: [
      { id: "kuechenzeile", name: "Küchenzeile", b: 1.8, t: 0.6, kategorie: "furn", benutzerseite: true },
      { id: "tisch", name: "Tisch", b: 1.2, t: 0.8, kategorie: "furn", benutzerseite: false },
      { id: "kuehlschrank", name: "Kühlschrank", b: 0.6, t: 0.6, kategorie: "furn", benutzerseite: false },
    ],
  },
];

// ---- Wohn-Gruppe (75-09, Blatt 07) --------------------------------------------------------
// Eigene Konstante, NICHT Teil von MOEBEL_KATALOG (Bestandstest pinnt 5 Gruppen / 15 Typen).
// Maße in Metern, 1:1 aus dem Lösungskatalog Blatt 07 (Textextrakt :183-193) — alle Werte
// dort sind Richtwerte ⇒ [ASSUMED]; Weg zu belegten Werten: Herstellerangaben /
// Ausführungsplanung. Bewegungsflächen (bewegung.seiten, Meter):
//   Bett eine Längsseite 0,90 (Standard) · Schrank 0,90 · Sofa 0,80 · Esstisch 0,80 rundum
//   · Küchenzeile 1,20 · Schreibtisch 0,90 (Tiefe wie Schrank).
//   rolle "haupt" wächst mit Stufe B/R auf accessibility.bewegungsflaeche (1,20 / 1,50 m,
//   DIN 18040-2); rolle "fest" bleibt in jeder Stufe (Tisch-Nebenseiten 0,80).
// Nicht einfrieren — frozen Arrays werden unter checkJs `readonly` und brechen Props (75-08).
/**
 * Living-furniture catalogue of the 1:50 apartment focus (75-09, Blatt 07).
 * Group shape matches MOEBEL_KATALOG groups ({gruppe, typen}); dims in METRES.
 * @type {{gruppe: string, typen: Array<object>}}
 */
export const WOHN_GRUPPE = {
  gruppe: "Wohnen",
  typen: [
    // Bett: Kopfende an der Wand, EINE Längsseite frei (Blatt 07 :184). [ASSUMED]
    {
      id: "doppelbett", name: "Doppelbett", b: 1.8, t: 2.0, kategorie: "furn", benutzerseite: false,
      bewegung: { seiten: [{ seite: "links", rolle: "haupt", standard: 0.9 }] },
    },
    {
      id: "einzelbett", name: "Einzelbett", b: 0.9, t: 2.0, kategorie: "furn", benutzerseite: false,
      bewegung: { seiten: [{ seite: "links", rolle: "haupt", standard: 0.9 }] },
    },
    // Nachttisch 0,45 × 0,40 — Blatt 07 nennt kein Maß; übliche Handelsmaße. [ASSUMED]
    // Regel in_bewegungsflaeche_ok: Niedrige Möbel dürfen in der Bewegungsfläche des
    // Betts stehen (Nachttisch am Kopfende, Blatt 07 :200 setzt ihn dorthin) — sie
    // blockieren keinen Durchgang. [ASSUMED] Ohne die Regel wäre die Auto-Möblierung
    // nie warnungsfrei (Akzeptanz „wohnMoebelChecks = []").
    {
      id: "nachttisch", name: "Nachttisch", b: 0.45, t: 0.4, kategorie: "furn", benutzerseite: false,
      regeln: ["in_bewegungsflaeche_ok"],
    },
    // Kleiderschrank: Breite n × 0,50, Tiefe 0,60 (Blatt 07 :186) — Türen ausschwenkbar,
    // nicht vor Fenster ⇒ regel "nicht_vor_fenster" (Prüfung in wohnMoebel.sperrGrund).
    {
      id: "schrank_100", name: "Kleiderschrank 2 × 50", b: 1.0, t: 0.6, kategorie: "furn", benutzerseite: true,
      bewegung: { seiten: [{ seite: "vorn", rolle: "haupt", standard: 0.9 }] }, regeln: ["nicht_vor_fenster"],
    },
    {
      id: "schrank_150", name: "Kleiderschrank 3 × 50", b: 1.5, t: 0.6, kategorie: "furn", benutzerseite: true,
      bewegung: { seiten: [{ seite: "vorn", rolle: "haupt", standard: 0.9 }] }, regeln: ["nicht_vor_fenster"],
    },
    {
      id: "schrank_200", name: "Kleiderschrank 4 × 50", b: 2.0, t: 0.6, kategorie: "furn", benutzerseite: true,
      bewegung: { seiten: [{ seite: "vorn", rolle: "haupt", standard: 0.9 }] }, regeln: ["nicht_vor_fenster"],
    },
    {
      id: "schrank_250", name: "Kleiderschrank 5 × 50", b: 2.5, t: 0.6, kategorie: "furn", benutzerseite: true,
      bewegung: { seiten: [{ seite: "vorn", rolle: "haupt", standard: 0.9 }] }, regeln: ["nicht_vor_fenster"],
    },
    {
      id: "schrank_300", name: "Kleiderschrank 6 × 50", b: 3.0, t: 0.6, kategorie: "furn", benutzerseite: true,
      bewegung: { seiten: [{ seite: "vorn", rolle: "haupt", standard: 0.9 }] }, regeln: ["nicht_vor_fenster"],
    },
    // Sofa 3-Sitzer 2,20 × 0,90, 0,80 davor (Blatt 07 :187). [ASSUMED]
    {
      id: "sofa_3", name: "Sofa 3-Sitzer", b: 2.2, t: 0.9, kategorie: "furn", benutzerseite: true,
      bewegung: { seiten: [{ seite: "vorn", rolle: "haupt", standard: 0.8 }] },
    },
    // Couchtisch 1,00 × 0,60 — kein Blattmaß; übliche Handelsmaße. [ASSUMED]
    { id: "couchtisch", name: "Couchtisch", b: 1.0, t: 0.6, kategorie: "furn", benutzerseite: false },
    // Esstisch 0,80 rundum (Stuhl + Gang, Blatt 07 :188): 4er ⇒ 2,80 × 2,40 m Gesamtfläche,
    // 6er ⇒ 3,40 × 2,50 m. Vorderseite "haupt" (wächst bei B/R auf 1,20/1,50 — nur vorn,
    // die drei Nebenseiten bleiben fest 0,80). [ASSUMED]
    {
      id: "esstisch_4", name: "Esstisch 4 P", b: 1.2, t: 0.8, kategorie: "desk", benutzerseite: false,
      bewegung: {
        seiten: [
          { seite: "vorn", rolle: "haupt", standard: 0.8 },
          { seite: "hinten", rolle: "fest", standard: 0.8 },
          { seite: "links", rolle: "fest", standard: 0.8 },
          { seite: "rechts", rolle: "fest", standard: 0.8 },
        ],
      },
      regeln: ["in_bewegungsflaeche_ok"],
    },
    {
      id: "esstisch_6", name: "Esstisch 6 P", b: 1.8, t: 0.9, kategorie: "desk", benutzerseite: false,
      bewegung: {
        seiten: [
          { seite: "vorn", rolle: "haupt", standard: 0.8 },
          { seite: "hinten", rolle: "fest", standard: 0.8 },
          { seite: "links", rolle: "fest", standard: 0.8 },
          { seite: "rechts", rolle: "fest", standard: 0.8 },
        ],
      },
      regeln: ["in_bewegungsflaeche_ok"],
    },
    // Küchenzeile Tiefe 0,60, Länge ≥ 3,00 m; 1,20 davor, 1,50 barrierefrei (Blatt 07 :189;
    // Stufe B liefert accessibility 1,20, Stufe R 1,50 — Standard hier 1,20 wie Blatt 07).
    {
      id: "kuechenzeile_300", name: "Küchenzeile 3,00 m", b: 3.0, t: 0.6, kategorie: "furn", benutzerseite: true,
      bewegung: { seiten: [{ seite: "vorn", rolle: "haupt", standard: 1.2 }] },
    },
    // Kinder-Schreibtisch 1,20 × 0,60 (Blatt 07 :185 „+ Schreibtisch 120 × 60“);
    // Bewegungsfläche 0,90 = Tiefe wie Schrank (kein Blattmaß). [ASSUMED]
    {
      id: "schreibtisch_kind", name: "Schreibtisch 120", b: 1.2, t: 0.6, kategorie: "desk", benutzerseite: true,
      bewegung: { seiten: [{ seite: "vorn", rolle: "haupt", standard: 0.9 }] },
    },
    // Türen (MSB-14, Blatt 07 :193, Aufschlag 90°). Nutzerentscheidung D-P75-09-A
    // (23.09.2026): b ist das ROHBAUMASS (Wandöffnungs-Nennmaß DIN 18100) — Standard 885 mm
    // (Baurichtmaß 875), barrierefrei 1010 mm (Baurichtmaß 1000; die Blatt-07-Zahl 98,5
    // kommt in der Normreihe nicht vor). Die lichte Durchgangsbreite wird abgeleitet:
    // lichte_m = Rohbaumaß − 0,025 m (Zargen-/Falzabzug der DIN-18100-Reihe: 885 → 860,
    // 1010 → 985 mm) und in der UI angezeigt. t = Symboltiefe in der Wand (0,10 m) [ASSUMED].
    {
      id: "tuer_885", name: "Tür 88,5", b: 0.885, t: 0.1, kategorie: "furn", benutzerseite: false,
      tuer: { lichte_m: 0.86 },
    },
    {
      id: "tuer_1010", name: "Tür 101 (barrierefrei)", b: 1.01, t: 0.1, kategorie: "furn", benutzerseite: false,
      tuer: { lichte_m: 0.985 },
    },
  ],
};

// Flacher Index typId → Typ (einmalig aufgebaut). Enthält Katalog UND Wohn-Gruppe (75-09),
// damit moebelById/itemRect/alle Renderer die Wohn-Typen kennen; MOEBEL_KATALOG bleibt
// unangetastet (Bestandstest).
const BY_ID = new Map([...MOEBEL_KATALOG, WOHN_GRUPPE].flatMap((g) => g.typen.map((t) => [t.id, t])));

// ---- Eigene Möbeltypen (Phase 43, MOEBEL-04) --------------------------------------------
// Register statt Signatur-Änderung: die App arbeitet auf EINEM aktiven Projekt (wie der
// buildingProgram-Store); InteriorDesigner/AsrRaumdatenblatt setzen es aus complexData,
// Tests setzen es mit [] zurück.
/** Katalog-Gruppe, unter der eigene Typen erscheinen. */
export const EIGENE_GRUPPE = "Eigene";
/** Erlaubte Kategorien (Farbe/Legende) für eigene Typen. */
export const MOEBEL_KATEGORIEN = ["desk", "chair", "furn", "sanitaer"];
let EIGENE = new Map();

/**
 * Setzt die eigenen Typen des aktiven Projekts (ersetzt den vorherigen Stand).
 * @param {Array<{id:string,name:string,b:number,t:number,kategorie:string,benutzerseite:boolean}>|null|undefined} liste
 */
export function setzeEigeneTypen(liste) {
  EIGENE = new Map((liste || []).filter((t) => t && t.id).map((t) => [t.id, t]));
}

/** @returns {Array<object>} die registrierten eigenen Typen (Kopie der Liste) */
export function eigeneTypen() {
  return [...EIGENE.values()];
}

/** Typ nach Id — Katalog zuerst, dann eigene Typen; null wenn unbekannt. */
export const moebelById = (id) => BY_ID.get(id) || EIGENE.get(id) || null;

/**
 * Katalog plus Gruppe „Eigene" (nur wenn es eigene Typen gibt).
 * @param {Array<object>} [eigene] explizite Liste; Default = Register
 */
export function katalogMitEigenen(eigene) {
  const liste = eigene || eigeneTypen();
  return liste.length ? [...MOEBEL_KATALOG, { gruppe: EIGENE_GRUPPE, typen: liste }] : MOEBEL_KATALOG;
}

const slug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "typ";

/**
 * Validiert und baut einen eigenen Typ. Fehler im Klartext, nie eine Exception.
 * @param {{name?:string,b?:number|string,t?:number|string,kategorie?:string,benutzerseite?:boolean}} eingabe
 *   b = Breite entlang der Benutzerseite, t = Tiefe — beide in Metern
 * @param {Array<{id:string}>} [vorhandene] bereits angelegte eigene Typen (Id-Eindeutigkeit)
 * @returns {{ok:true, typ:object}|{ok:false, fehler:string}}
 */
export function neuerEigenerTyp(eingabe, vorhandene = []) {
  const name = String(eingabe?.name || "").trim();
  const b = Number(eingabe?.b), t = Number(eingabe?.t);
  if (!name) return { ok: false, fehler: "Name fehlt." };
  if (!Number.isFinite(b) || b <= 0 || !Number.isFinite(t) || t <= 0) return { ok: false, fehler: "Breite und Tiefe müssen größer als 0 m sein." };
  if (b > 20 || t > 20) return { ok: false, fehler: "Maße über 20 m sind kein Möbel." }; // [ASSUMED] Plausibilitätsgrenze
  const kategorie = MOEBEL_KATEGORIEN.includes(eingabe?.kategorie) ? eingabe.kategorie : "furn";
  const ids = new Set([...BY_ID.keys(), ...(vorhandene || []).map((v) => v.id)]);
  let id = `eigen-${slug(name)}`;
  for (let n = 2; ids.has(id); n++) id = `eigen-${slug(name)}-${n}`;
  return { ok: true, typ: { id, name, b: Math.round(b * 100) / 100, t: Math.round(t * 100) / 100, kategorie, benutzerseite: !!eingabe?.benutzerseite } };
}

/**
 * Wird ein Typ irgendwo in der Möblierung verwendet? (Löschen eigener Typen sperren.)
 * @param {Record<string, Array<{typ:string}>>|null|undefined} moeblierung
 * @param {string} typId
 */
export function typInBenutzung(moeblierung, typId) {
  return Object.values(moeblierung || {}).some((items) => (items || []).some((it) => it?.typ === typId));
}

// ---- Raumschlüssel (Phase 43, MOEBEL-04) --------------------------------------------------

/**
 * Legacy-Schlüssel `${level}:${name}` — MUSS dem Format von asr.roomKey entsprechen, weil
 * Bestandsdaten darunter liegen (Test „zoneKey ohne id == roomKey" sichert das).
 * @param {{level?:number,name?:string}|null|undefined} zone
 */
export const legacyRoomKey = (zone) => `${zone?.level ?? 0}:${zone?.name ?? "Raum"}`;

/**
 * Schlüssel einer Zone in complexData.moeblierung: `id:<zone.id>` für Räume mit stabiler id
 * (BIM-Studio, seit Phase 43 im Store), sonst der Legacy-Schlüssel (generierte Räume ·W/·WT).
 * @param {{id?:number|string,level?:number,name?:string}|null|undefined} zone
 * @returns {string}
 */
export function zoneKey(zone) {
  if (zone && zone.id != null && zone.id !== "") return `id:${zone.id}`;
  return legacyRoomKey(zone);
}

/**
 * Möbel einer Zone — id-Schlüssel zuerst, sonst der Legacy-Eintrag (noch nicht migriert).
 * @param {Record<string, Array<object>>|null|undefined} moeblierung
 * @param {object} zone
 * @returns {Array<object>} nie null
 */
export function moebelFuerZone(moeblierung, zone) {
  const m = moeblierung || {};
  const k = zoneKey(zone);
  if (Array.isArray(m[k])) return m[k];
  const legacy = legacyRoomKey(zone);
  if (k !== legacy && Array.isArray(m[legacy])) return m[legacy];
  return [];
}

/**
 * Neue Möblierung mit `items` für die Zone unter ihrem zoneKey; ein Legacy-Eintrag derselben
 * Zone wird dabei entfernt (sonst bliebe eine unsichtbare Dublette zurück).
 * @param {Record<string, Array<object>>|null|undefined} moeblierung
 * @param {object} zone
 * @param {Array<object>} items
 * @returns {Record<string, Array<object>>}
 */
export function mitMoebelFuerZone(moeblierung, zone, items) {
  const out = { ...(moeblierung || {}) };
  const k = zoneKey(zone);
  const legacy = legacyRoomKey(zone);
  if (k !== legacy) delete out[legacy];
  out[k] = items;
  return out;
}

/**
 * Hebt Legacy-Einträge (`level:name`) auf den id-Schlüssel der passenden Zone — nur wenn dort
 * noch nichts liegt. Idempotent; Einträge generierter Räume bleiben, wie sie sind.
 * Dokumentierte Grenze: teilen zwei Zonen desselben Geschosses einen Namen, bekommt die erste
 * Zone mit id den Legacy-Eintrag.
 * @param {Record<string, Array<object>>|null|undefined} moeblierung
 * @param {Array<object>} zones
 * @returns {{moeblierung: Record<string, Array<object>>, verschoben: number}}
 */
export function migriereMoeblierung(moeblierung, zones) {
  const m = moeblierung || {};
  const out = { ...m };
  let verschoben = 0;
  for (const z of zones || []) {
    const k = zoneKey(z);
    const legacy = legacyRoomKey(z);
    if (k === legacy) continue;
    if (Array.isArray(out[legacy]) && !Array.isArray(out[k])) {
      out[k] = out[legacy];
      delete out[legacy];
      verschoben++;
    }
  }
  return { moeblierung: verschoben ? out : m, verschoben };
}

/**
 * Schlüssel mit Möbeln, zu denen keine Zone (weder per id noch per Legacy-Schlüssel) mehr
 * existiert — z. B. nach einem Rename vor Phase 43 oder nach dem Löschen eines Raums.
 * Leere Listen zählen nicht.
 * @param {Record<string, Array<object>>|null|undefined} moeblierung
 * @param {Array<object>} zones
 * @returns {string[]}
 */
export function verwaisteKeys(moeblierung, zones) {
  const m = moeblierung || {};
  const bekannt = new Set();
  (zones || []).forEach((z) => { bekannt.add(zoneKey(z)); bekannt.add(legacyRoomKey(z)); });
  return Object.keys(m).filter((k) => !bekannt.has(k) && Array.isArray(m[k]) && m[k].length > 0);
}

// Achsen-Ausdehnung eines Items nach Rotation: bei 90/270 tauschen b und t.
// Rückgabe { w, h } (Meter) — w entlang x, h entlang y.
export function itemAusdehnung(item) {
  const typ = moebelById(item.typ);
  if (!typ) return { w: 0, h: 0 };
  const gedreht = item.rot === 90 || item.rot === 270;
  return { w: gedreht ? typ.t : typ.b, h: gedreht ? typ.b : typ.t };
}

// AABB eines Items { x, y, w, h } (x/y = linke obere Ecke, Meter).
export function itemRect(item) {
  const { w, h } = itemAusdehnung(item);
  return { x: item.x - w / 2, y: item.y - h / 2, w, h };
}

// ---- Verschieben per Drag (Phase 43, MOEBEL-01) ----------------------------------------

/**
 * Drag grid for furniture in metres. [ASSUMED] 5 cm is the usual furniture-planning
 * resolution; the 10 cm arrow-key step (InteriorDesigner SCHRITT) stays for keyboard moves.
 */
export const MOEBEL_RASTER = 0.05;

/**
 * Snap a length to a grid.
 * @param {number} v value in metres
 * @param {number} [raster=MOEBEL_RASTER] grid in metres
 * @returns {number} snapped value, rounded to 2 decimals (kills 0.1+0.2 noise)
 */
export function snapRaster(v, raster = MOEBEL_RASTER) {
  const r = raster > 0 ? raster : MOEBEL_RASTER;
  return Math.round(Math.round(v / r) * r * 100) / 100;
}

/**
 * Copy of an item moved to a new centre; x/y are snapped to the drag grid.
 * Pure — the caller writes the result into complexData.moeblierung.
 * @param {{id:string,typ:string,x:number,y:number,rot:number}} item
 * @param {number} x new centre x in metres (zone coordinates)
 * @param {number} y new centre y in metres (zone z axis)
 * @param {number} [raster=MOEBEL_RASTER]
 */
export function verschiebeItem(item, x, y, raster = MOEBEL_RASTER) {
  return { ...item, x: snapRaster(x, raster), y: snapRaster(y, raster) };
}

// [ASSUMED] Freizuhaltende Bewegungsfläche Benutzerseite: 1,00 m tief (ASR A1.2)
// über die volle Benutzerseiten-Breite. Bei rot=0 liegt die Benutzerseite "unten"
// (+y), 90 → links (−x), 180 → oben (−y), 270 → rechts (+x).
export const BEWEGUNG_TIEFE = 1.0;

/**
 * Movement-area rectangle in front of the user side (ASR A1.2 convention:
 * rot 0 → +y, 90 → −x, 180 → −y, 270 → +x), optionally deepened per
 * accessibility level (75-09, Blatt 07 / DIN 18040-2).
 * @param {{id?:string,typ:string,x:number,y:number,rot?:number}} item furniture item (centre in METRES, zone coords)
 * @param {"B"|"R"} [stufe] ONLY "B" (1,20 m) / "R" (1,50 m) widen the depth via
 *   accessibility.bewegungsflaeche; anything else (incl. "standard"/undefined)
 *   keeps EXACTLY BEWEGUNG_TIEFE (1,00 m) — byte-identical for every existing
 *   caller (AsrRaumdatenblatt / InteriorDesigner / MoeblierungsPlan call without stufe).
 * @returns {{x:number,y:number,w:number,h:number}|null} rect in METRES (x/y = top-left),
 *   null when the type is unknown or has no user side
 */
export function bewegungsflaecheRect(item, stufe) {
  const typ = moebelById(item.typ);
  if (!typ || !typ.benutzerseite) return null;
  const r = itemRect(item);
  // Depth in metres: accessibility level applies ONLY to "B"/"R" (the helper
  // returns 1.20 for everything ≠ "R", so an unknown level must NOT call it).
  const T = stufe === "B" || stufe === "R" ? bewegungsflaeche(stufe) : BEWEGUNG_TIEFE;
  switch (item.rot) {
    case 90:  return { x: r.x - T, y: r.y, w: T, h: r.h };
    case 180: return { x: r.x, y: r.y - T, w: r.w, h: T };
    case 270: return { x: r.x + r.w, y: r.y, w: T, h: r.h };
    default:  return { x: r.x, y: r.y + r.h, w: r.w, h: T }; // rot 0
  }
}

// AABB-Überlappung zweier Rechtecke { x, y, w, h }.
const rectsUeberlappen = (a, b) =>
  a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Kollision zweier Möbel (AABB nach Rotation).
export const kollidiert = (itemA, itemB) => rectsUeberlappen(itemRect(itemA), itemRect(itemB));

// Überlappungs-Warnungen je Raum (KD-14): jedes Paar wird genau EINMAL geprüft.
// `itemIds` nennt beide Beteiligten, damit die Draufsicht sie markieren kann.
// Bewusst NUR warn, NIE fail — konsistent zu moebelChecks (keine harte Sperre).
export function kollisionsWarnungen(items) {
  const liste = items || [];
  const warnungen = [];
  for (let i = 0; i < liste.length; i++) {
    for (let j = i + 1; j < liste.length; j++) {
      const a = liste[i], b = liste[j];
      if (!kollidiert(a, b)) continue;
      const nameA = moebelById(a.typ)?.name || a.typ;
      const nameB = moebelById(b.typ)?.name || b.typ;
      warnungen.push({
        status: "warn",
        itemId: a.id,
        itemIds: [a.id, b.id],
        text: `${nameA} überlappt ${nameB} in der Draufsicht.`,
      });
    }
  }
  return warnungen;
}

// Point-in-Polygon (Ray-Casting) — Polygon = Zone-Points [{x, z}].
// Lokal implementiert; @core/lib führt keinen point-in-polygon-Helfer.
export function punktImPolygon(px, py, points) {
  if (!points || points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].z;
    const xj = points[j].x, yj = points[j].z;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Item vollständig im Raum? Alle 4 AABB-Ecken müssen im Zone-Polygon liegen.
export function imRaum(item, polygon) {
  const r = itemRect(item);
  return [
    [r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h],
  ].every(([x, y]) => punktImPolygon(x, y, polygon));
}

// Konzept-Checks je Raum — bewusst NUR warn, NIE fail (Haftung, wie asr.js).
// items = [{id, typ, x, y, rot}], polygon = Zone-Points.
export function moebelChecks(items, polygon) {
  const warnungen = [];
  (items || []).forEach((item) => {
    const typ = moebelById(item.typ);
    const name = typ?.name || item.typ;
    if (polygon && polygon.length >= 3 && !imRaum(item, polygon)) {
      warnungen.push({ status: "warn", itemId: item.id, text: `${name} ragt aus dem Raum heraus.` });
    }
  });
  // Fremde Bewegungsflächen: Item A steht in der Bewegungsfläche von Item B (A ≠ B).
  (items || []).forEach((b) => {
    const band = bewegungsflaecheRect(b);
    if (!band) return;
    (items || []).forEach((a) => {
      if (a.id === b.id) return;
      if (rectsUeberlappen(itemRect(a), band)) {
        const nameA = moebelById(a.typ)?.name || a.typ;
        const nameB = moebelById(b.typ)?.name || b.typ;
        warnungen.push({
          status: "warn",
          itemId: a.id,
          text: `${nameA} steht in der Bewegungsfläche von ${nameB} (1,00 m, ASR A1.2).`,
        });
      }
    });
  });
  return warnungen;
}
