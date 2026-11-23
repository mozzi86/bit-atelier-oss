// Möbelkatalog + Geometrie-Helfer für die Raum-Möblierung (Innenausbau + ASR-Draufsicht).
//
// 75-09: einziger Import ist accessibility.js (selbst import-frei ⇒ kein Zyklus) für die
// Bewegungsflächen-Tiefen der Stufen B/R. wohnMoebel.js importiert DIESE Datei, nie umgekehrt.
import { bewegungsflaeche } from "@designer/lib/accessibility";
//
// Datenmodell (persistiert in complexData):
//   complexData.moeblierung = { [zoneKey]: [{ id, typ, x, y, rot }] }
//     - zoneKey (see "Room keys" below): W-1118-02 `guid:<zone.guid>` for model rooms with a stored GUID (survives a
//       rebuild of the rooms, the _idx does not); phase 43 `id:<zone.id>` (zone.id = the record's _idx) for model rooms
//       without a GUID yet; for generated rooms (·W, ·WT) the legacy key `${level}:${name}` (= asr.roomKey).
//       Older keys are read and moved on open (migriereMoeblierung, called by ComplexDesigner) — an `id:` entry only
//       when the furniture provably belongs to that room, otherwise it is listed as "Möbel ohne Raum" (moebelOhneRaum).
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

// ---- Room keys (phase 43 MOEBEL-04, W-1118-02) ----------------------------------------------
//
// Key formats in complexData.moeblierung, newest first (all are read, none is renamed):
//   `guid:<zone.guid>`  W-1118-02: rooms whose record carries a stored 22-character GUID (pinned by guidsAnheften when the
//                       BIM studio saves). The GUID travels with the room when the rooms are rebuilt, the _idx does not.
//   `id:<zone.id>`      phase 43: store `id` = the record's `_idx`. Still the key of rooms WITHOUT a stored GUID (written by a
//                       tool that sets none and not saved by the studio since, or drawn a moment ago: the studio's save writes
//                       the pinned GUID back into its state, so a drawn room has the GUID key about 1.2 s later — review
//                       R-W111802-1). For a room WITH a GUID an `id:` entry is old data: it is only moved to the GUID key when the
//                       furniture provably belongs to that room (eintragPruefen), otherwise it stays and is listed as "Möbel
//                       ohne Raum" (moebelOhneRaum).
//   `<level>:<name>`    before phase 43 and the generated rooms (·W, ·WT), = asr.roomKey.

/**
 * Legacy key `${level}:${name}` — MUST match asr.roomKey, old data lies under it (test "zoneKey ohne id == roomKey").
 * @param {{level?:number,name?:string}|null|undefined} zone
 */
export const legacyRoomKey = (zone) => `${zone?.level ?? 0}:${zone?.name ?? "Raum"}`;

/**
 * Edge tolerance in METRES for "the furniture centre lies in the room of its `_idx`". [ASSUMED] one drag-grid step
 * (MOEBEL_RASTER = 5 cm): absorbs an outline that was re-drawn a few centimetres off; far below any room width, so it never
 * reaches into the neighbouring room. Competing rooms are tested WITHOUT tolerance (see eintragPruefen).
 */
export const RAUM_TOLERANZ_M = 0.05;

/**
 * Stored GUID of a room as the furniture key uses it. Only a 22-character string counts — the same rule as bauteilGuid /
 * guidsAnheften (@core/lib/bauteil/steckbrief.js); any other value is re-derived from `_idx` there and is not stable.
 * @param {{guid?: unknown}|null|undefined} zone store zone
 * @returns {string|null} the GUID, null when the room has none (yet)
 */
export function raumGuid(zone) {
  const g = zone?.guid;
  return typeof g === "string" && g.length === 22 ? g : null;
}

/**
 * `id:<zone.id>` key of a model room (BIM studio, `id` = the record's `_idx`), null for rooms without id (·W/·WT).
 * @param {{id?: number|string}|null|undefined} zone
 * @returns {string|null}
 */
function idSchluessel(zone) {
  return zone && zone.id != null && zone.id !== "" ? `id:${zone.id}` : null;
}

/** A room of the building model (has an `_idx` or a GUID) — only these can ever have stood behind an `id:` key. @param {any} z */
const istModellRaum = (z) => idSchluessel(z) != null || raumGuid(z) != null;

/**
 * Key of a zone in complexData.moeblierung: `guid:<guid>` for rooms with a stored GUID, else `id:<id>` for model rooms,
 * else the legacy key (generated rooms ·W/·WT).
 * @param {{id?:number|string,guid?:string,level?:number,name?:string}|null|undefined} zone
 * @returns {string}
 */
export function zoneKey(zone) {
  const g = raumGuid(zone);
  if (g) return `guid:${g}`;
  return idSchluessel(zone) ?? legacyRoomKey(zone);
}

/**
 * Furniture of a zone: its own key first, else the legacy entry (not migrated yet). An `id:` entry of a room that has a
 * GUID is deliberately NOT read here — after a rebuild that `_idx` may belong to another room (W-1118-02); migriereMoeblierung
 * moves it when it provably belongs here, otherwise moebelOhneRaum lists it.
 * @param {Record<string, Array<object>>|null|undefined} moeblierung
 * @param {object} zone
 * @returns {Array<object>} never null
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
 * New furnishing with `items` for the zone under its zoneKey; a legacy entry of the same zone is removed (moebelFuerZone
 * showed it, so it is part of `items` — else an invisible duplicate would stay). An `id:` entry is left alone: it was not
 * shown in this room (see moebelFuerZone).
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
 * Distance in METRES from the point (px, py) to the edge a–b of a zone outline ({x, z} points; py runs along z).
 * @param {number} px @param {number} py @param {{x:number,z:number}} a @param {{x:number,z:number}} b
 */
function abstandZurKante(px, py, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.z) * dz) / l2)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.z + t * dz));
}

/**
 * Do ALL furniture centres lie in the outline of the room? (W-1118-02: the evidence that an `id:` entry still belongs to
 * the room of that `_idx`.) The centre counts, not the whole body — furniture may stick out of a room (moebelChecks warns).
 * @param {Array<{x?: number, y?: number}>|null|undefined} items furniture, centre x/y in METRES (zone coordinates)
 * @param {{points?: Array<{x:number,z:number}>}|null|undefined} zone room with its outline in METRES
 * @param {number} [toleranz_m=0] a centre this close to the outline (METRES) still counts as inside
 * @returns {boolean} false for an empty list, a room without outline (< 3 points) or an item without a finite centre
 */
export function moebelImUmriss(items, zone, toleranz_m = 0) {
  const pts = zone?.points;
  if (!Array.isArray(pts) || pts.length < 3 || !Array.isArray(items) || !items.length) return false;
  return items.every((it) => mittelpunktImUmriss(it, pts, toleranz_m));
}

/**
 * Does the centre of one item lie in the outline (or within `toleranz_m` METRES of its edge)?
 * @param {{x?: number, y?: number}|null|undefined} it @param {Array<{x:number,z:number}>} pts outline, ≥ 3 points
 * @param {number} toleranz_m
 */
function mittelpunktImUmriss(it, pts, toleranz_m) {
  const x = it?.x, y = it?.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (punktImPolygon(/** @type {number} */ (x), /** @type {number} */ (y), pts)) return true;
  if (!(toleranz_m > 0)) return false;
  for (let i = 0; i < pts.length; i++) if (abstandZurKante(/** @type {number} */ (x), /** @type {number} */ (y), pts[i], pts[(i + 1) % pts.length]) <= toleranz_m) return true;
  return false;
}

/**
 * Number of furniture centres in the outline of the room, edge tolerance RAUM_TOLERANZ_M (review R-2: one piece dragged into the
 * corridor must not cost the whole list its room). 0 for a room without outline.
 * @param {Array<{x?: number, y?: number}>|null|undefined} items @param {{points?: Array<{x:number,z:number}>}|null|undefined} zone
 * @returns {number}
 */
function anzahlImUmriss(items, zone) {
  const pts = zone?.points;
  if (!Array.isArray(pts) || pts.length < 3 || !Array.isArray(items)) return 0;
  return items.filter((it) => mittelpunktImUmriss(it, pts, RAUM_TOLERANZ_M)).length;
}

/**
 * Do all furniture centres lie in the bounding rectangle of the room (edge tolerance RAUM_TOLERANZ_M)? Review R-1: the app
 * inserts new furniture at the centre of that rectangle (InteriorDesigner RaumKarte.addTyp, MoeblierungsPlan zonenMitte) — in an
 * L- or U-shaped room that point lies outside the outline, often in the room in the notch, so the outline alone would disown
 * furniture the app placed itself.
 * @param {Array<{x?: number, y?: number}>|null|undefined} items @param {{points?: Array<{x:number,z:number}>}|null|undefined} zone
 * @returns {boolean} false for an empty list or a room without outline
 */
function alleImRechteck(items, zone) {
  const pts = zone?.points;
  if (!Array.isArray(pts) || pts.length < 3 || !Array.isArray(items) || !items.length) return false;
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  const t = RAUM_TOLERANZ_M;
  const [x0, x1, z0, z1] = [Math.min(...xs) - t, Math.max(...xs) + t, Math.min(...zs) - t, Math.max(...zs) + t];
  return items.every((it) => Number.isFinite(it?.x) && Number.isFinite(it?.y)
    && /** @type {number} */ (it?.x) >= x0 && /** @type {number} */ (it?.x) <= x1 && /** @type {number} */ (it?.y) >= z0 && /** @type {number} */ (it?.y) <= z1);
}

/**
 * Furniture evidence for the room an entry was made for (reviews R-1/R-2, the same rule for the proposal in moebelOhneRaum and —
 * with the GUID evidence — for the migration, final review MIG-1/F2): every centre in its outline, MORE than half of them (one
 * piece dragged into the corridor), or every centre in its bounding rectangle (the app's own insertion point in an L-shaped room).
 * @param {Array<{x?: number, y?: number}>} items non-empty @param {object} raum
 * @returns {boolean}
 */
function lageBelegt(items, raum) {
  const n = anzahlImUmriss(items, raum);
  return n === items.length || 2 * n > items.length || alleImRechteck(items, raum);
}

/**
 * [ASSUMED] Area factor from which a room around the own room counts as a zone AROUND it (an apartment zone "WE 1" around its rooms
 * on the same storey, final review F2 A) instead of a duplicate: 1.2 = at least 20 % more area. A room drawn a second time one drag
 * grid step (5 cm) larger on every side stays below it down to a 1.5 × 1.5 m WC (1.6² / 1.5² = 1.14); an apartment zone is far
 * larger than any single room in it. No standard behind the value — it only separates "drawn twice" from "a zone around rooms".
 */
const UMSCHLIESSUNG_FAKTOR = 1.2;

/** Area of an outline in m² (shoelace over the x/z points in metres). @param {Array<{x:number,z:number}>} pts */
function flaecheM2(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.z - b.x * a.z;
  }
  return Math.abs(s) / 2;
}

/**
 * Does `aussen` enclose the room `innen` as a zone around it (final review F2 A)? Every corner of `innen` lies in the outline of
 * `aussen` (edge tolerance RAUM_TOLERANZ_M — an apartment zone usually shares the outer walls with its rooms) and `aussen` has at
 * least UMSCHLIESSUNG_FAKTOR times the area. A room of about the same size at the same spot is a duplicate, not a zone around it.
 * @param {any} aussen @param {any} innen store zones with outlines in METRES
 * @returns {boolean}
 */
function umschliesst(aussen, innen) {
  const pa = aussen?.points, pi = innen?.points;
  if (!Array.isArray(pa) || pa.length < 3 || !Array.isArray(pi) || pi.length < 3) return false;
  if (!pi.every((/** @type {{x:number,z:number}} */ p) => mittelpunktImUmriss({ x: p.x, y: p.z }, pa, RAUM_TOLERANZ_M))) return false;
  return flaecheM2(pa) >= UMSCHLIESSUNG_FAKTOR * flaecheM2(pi);
}

/**
 * Model rooms (any storey) whose outline holds every furniture centre — strict, except `raum` itself, which gets the
 * edge tolerance RAUM_TOLERANZ_M. One entry per key (two records with the same GUID count once).
 * @param {Array<object>} items @param {Array<object>|null|undefined} zones @param {object|null} raum
 * @returns {Array<object>}
 */
function kandidatenFuer(items, zones, raum) {
  const gesehen = new Set();
  /** @type {Array<object>} */
  const aus = [];
  for (const z of zones || []) {
    if (!istModellRaum(z)) continue;
    const k = zoneKey(z);
    if (gesehen.has(k) || !moebelImUmriss(items, z, z === raum ? RAUM_TOLERANZ_M : 0)) continue;
    gesehen.add(k);
    aus.push(z);
  }
  return aus;
}

/**
 * @typedef {"kein-raum"|"ohne-guid"|"ausserhalb"|"mehrdeutig"|"belegt"|"sicher"} IdBefund
 *   kein-raum  no room has this `_idx` today (for a `guid:` entry: no room kept the `_idx` its GUID was derived from, see eigenerRaum)
 *   ohne-guid  the room of the `_idx` has no GUID yet — the entry is its own key (old behaviour, nothing to move)
 *   ausserhalb the furniture evidence does not point to that room — it was probably placed in the room that had the `_idx` before.
 *              Without GUID evidence every centre must lie in the room; with it (never renumbered) lageBelegt is enough, unless
 *              another room of the same storey holds every centre (final review MIG-1/F2)
 *   mehrdeutig the furniture lies in that room AND in another model room (a stacked room on another storey, an overlapping
 *              or duplicated room) — the position cannot tell which room it was placed in (review R-3: a stacked room on another
 *              storey does not count when the room was never renumbered, see guidBeleg; final review F2: neither does a zone
 *              around the room on its own storey, see umschliesst)
 *   belegt     the room already has furniture under its GUID key — two lists for one room are not merged silently
 *   sicher     the furniture provably belongs to the room of the `_idx`: move it to the GUID key
 */

/**
 * @typedef {object} IdPruefOptionen
 * @property {(idx: number|string) => string} [guidAusIdx] the GUID the BIM studio pins for the room record with this `_idx`
 *   (guidsAnheften → bauteilGuid(projectId, "customZones", {_idx}), @core/lib/bauteil/steckbrief.js). The callers (ComplexDesigner,
 *   InteriorDesigner) pass it, so this module stays free of that import. Review R-3: a room whose GUID is exactly this value was
 *   never renumbered since the GUID was pinned. Without it the GUID evidence is not used (stacked rooms stay "mehrdeutig").
 */

/**
 * GUID evidence of the room of an `id:<_idx>` entry (review R-3). `unveraendert`: its GUID is the one derived from exactly this
 * `_idx`, so the record kept its `_idx` since the GUID was pinned — the entry was made for it. `umnummeriert`: its GUID came from
 * another `_idx` AND another room carries the GUID derived from this one — the `_idx` provably moved to a different room (a rebuild
 * that kept the GUIDs), so this room must not be proposed. Both false without IdPruefOptionen.guidAusIdx.
 * Limit (W-1118-01 / 115-05): a writer that rebuilds the rooms WITHOUT their GUIDs and renumbers them makes the next save derive
 * the GUIDs from the new `_idx` — then `unveraendert` is true for the wrong room; only the position checks remain.
 * @param {object} raum store zone with `id` (= `_idx`) and `guid` @param {Array<object>|null|undefined} zones @param {IdPruefOptionen} [opts]
 * @returns {{unveraendert: boolean, umnummeriert: boolean}}
 */
function guidBeleg(raum, zones, opts) {
  const ausIdx = typeof opts?.guidAusIdx === "function" ? opts.guidAusIdx(/** @type {any} */ (raum).id) : null;
  if (typeof ausIdx !== "string" || ausIdx.length !== 22) return { unveraendert: false, umnummeriert: false };
  const g = raumGuid(raum);
  return { unveraendert: g === ausIdx, umnummeriert: g !== ausIdx && (zones || []).some((z) => raumGuid(z) === ausIdx) };
}

/**
 * The room an entry was made for, with its GUID evidence (W-1118-02):
 *   `id:<_idx>`  the room that has this `_idx` today; evidence from guidBeleg.
 *   `guid:<g>`   (only for an entry no room shows) final review F-W111802-FINAL-1: the room that carries the `_idx` this GUID was
 *                derived from (g === guidAusIdx(_idx)) under ANOTHER GUID. "Raum teilen" (deckeTeilen, @core/lib/zeigen/teilen.js)
 *                gives both parts a new GUID and part A keeps the `_idx` — on main (key id:<_idx>) the furniture stayed in part A.
 *                The evidence stays STRICT here (no `unveraendert`): a rebuild that hands out new GUIDs and swaps the `_idx` of two
 *                stacked rooms would look the same, so only "every centre in that room and in no other room" moves the entry
 *                (the furniture stood in part A); furniture spread over both parts or with a stacked room above is listed with
 *                part A as the proposal.
 * Anything else (legacy keys, a GUID derived from no `_idx` of today's rooms, no IdPruefOptionen.guidAusIdx) has no room.
 * Limit: the reversal of the split gives the old GUID back; furniture moved to part A in between is then listed as
 * "Möbel ohne Raum" (part A's GUID is derived from no `_idx`), the restored room named as the room it lies in.
 * @param {string} key @param {Array<object>|null|undefined} zones @param {IdPruefOptionen} [opts]
 * @returns {{raum: object|null, beleg: {unveraendert: boolean, umnummeriert: boolean}}}
 */
function eigenerRaum(key, zones, opts) {
  const ohne = { unveraendert: false, umnummeriert: false };
  if (key.startsWith("id:")) {
    const raum = (zones || []).find((z) => idSchluessel(z) === key) || null;
    return { raum, beleg: raum && raumGuid(raum) ? guidBeleg(raum, zones, opts) : ohne };
  }
  const ausIdx = opts?.guidAusIdx;
  if (key.startsWith("guid:") && typeof ausIdx === "function") {
    const g = key.slice("guid:".length);
    const raum = (zones || []).find((z) => {
      const eigene = raumGuid(z);
      return idSchluessel(z) != null && eigene != null && eigene !== g && ausIdx(/** @type {any} */ (z).id) === g;
    }) || null;
    if (raum) return { raum, beleg: ohne };
  }
  return { raum: null, beleg: ohne };
}

/**
 * Checks an `id:<_idx>` entry — or a `guid:` entry no room shows (see eigenerRaum) — against today's rooms (W-1118-02). It is
 * "sicher" ONLY when its room (eigenerRaum) carries a GUID, the furniture evidence points to it, no other model room holds every
 * centre too (the furniture has no storey of its own, so a stacked room is just as possible), and the GUID key is still empty.
 * Without GUID evidence the evidence is strict: every centre in the outline (RAUM_TOLERANZ_M).
 * With it (guidBeleg `unveraendert`: the room was never renumbered since the GUID was pinned):
 *   - review R-3: rooms on OTHER storeys do not count against it (the stacked copies "Geschoss kopieren" makes);
 *   - final review F2 A: a zone AROUND the room on its own storey does not either (umschliesst; an apartment zone), a duplicate
 *     or any other room of the same storey that holds every centre still does — a rebuild WITHOUT GUIDs (W-1118-01 / 115-05) makes
 *     the next save derive the GUIDs from the new `_idx`, then `unveraendert` is wrongly true and this is the check that remains;
 *   - final review MIG-1 / F2 C: lageBelegt is enough (one chair dragged into the corridor, an item at the app's insertion point
 *     outside an L-shaped outline), the list moves as a whole like the proposal (review R-2).
 * Anything else is not guessed: moebelOhneRaum lists it.
 * @param {Record<string, Array<object>>} m furnishing
 * @param {string} key an `id:` key of `m`, or a `guid:` key no zone shows
 * @param {Array<object>|null|undefined} zones store zones of all storeys
 * @param {IdPruefOptionen} [opts]
 * @returns {{grund: IdBefund, raum: object|null, kandidaten: Array<object>, umnummeriert: boolean}}
 */
function eintragPruefen(m, key, zones, opts) {
  const items = m[key];
  const { raum, beleg } = eigenerRaum(key, zones, opts);
  const kandidaten = kandidatenFuer(items, zones, raum);
  /** @param {IdBefund} grund */
  const befund = (grund) => ({ grund, raum, kandidaten, umnummeriert: beleg.umnummeriert });
  if (!raum) return befund("kein-raum");
  if (!raumGuid(raum)) return befund("ohne-guid");
  const alleDrin = moebelImUmriss(items, raum, RAUM_TOLERANZ_M);
  if (!alleDrin && !(beleg.unveraendert && lageBelegt(items, raum))) return befund("ausserhalb");
  const eigener = zoneKey(raum);
  const ebene = /** @type {any} */ (raum).level ?? 0;
  const fremde = kandidaten.filter((z) => zoneKey(z) !== eigener
    && !(beleg.unveraendert && ((/** @type {any} */ (z).level ?? 0) !== ebene || umschliesst(z, raum))));
  if (fremde.length) return befund(alleDrin ? "mehrdeutig" : "ausserhalb");
  const ziel = m[eigener];
  if (Array.isArray(ziel) && ziel.length > 0) return befund("belegt");
  return befund("sicher");
}

/**
 * Migration on open (W-1118-02 + phase 43), pure — the caller puts the result into complexData and stores it (ComplexDesigner).
 * Two steps, in this order:
 *   1. `id:<_idx>` → `guid:<guid>` for every entry eintragPruefen calls "sicher"; every other `id:` entry stays as it is. The same
 *      for a `guid:` entry no room shows whose GUID was derived from the `_idx` a room still has (a split room, see eigenerRaum).
 *   2. legacy `level:name` → the zone's key (GUID or id) when nothing is there yet (phase 43). Documented limit: when two
 *      zones of one storey share a name, the first model room gets the legacy entry.
 * Idempotent; returns the SAME object (and verschoben 0) when nothing had to change, so a record that needs no change is
 * never rewritten. Empty lists are left alone.
 * @param {Record<string, Array<object>>|null|undefined} moeblierung
 * @param {Array<object>} zones store zones of all storeys ({points, level, name, id, guid})
 * @param {IdPruefOptionen} [opts] GUID evidence (review R-3); pass the same options as to moebelOhneRaum
 * @returns {{moeblierung: Record<string, Array<object>>, verschoben: number}}
 */
export function migriereMoeblierung(moeblierung, zones, opts) {
  const m = moeblierung || {};
  const out = { ...m };
  let verschoben = 0;
  const gezeigt = new Set((zones || []).map(zoneKey));
  for (const key of Object.keys(m)) {
    const pruefen = key.startsWith("id:") || (key.startsWith("guid:") && !gezeigt.has(key));
    if (!pruefen || !Array.isArray(out[key]) || !out[key].length) continue;
    const p = eintragPruefen(out, key, zones, opts);
    if (p.grund !== "sicher" || !p.raum) continue;
    out[zoneKey(p.raum)] = out[key];
    delete out[key];
    verschoben++;
  }
  for (const z of zones || []) {
    if (!istModellRaum(z)) continue;
    const k = zoneKey(z);
    const legacy = legacyRoomKey(z);
    if (Array.isArray(out[legacy]) && !Array.isArray(out[k])) {
      out[k] = out[legacy];
      delete out[legacy];
      verschoben++;
    }
  }
  return { moeblierung: verschoben ? out : m, verschoben };
}

/**
 * Keys with furniture that no zone shows (neither by its key nor by its legacy key): the room was deleted, renamed before
 * phase 43, rebuilt with a new GUID — or (W-1118-02) an `id:` entry of a room that has a GUID and could not be moved safely.
 * Empty lists do not count.
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

/**
 * @typedef {object} MoebelOhneRaum
 * @property {string} key stored key of the entry
 * @property {Array<object>} items its furniture
 * @property {"kein-raum"|"ausserhalb"|"mehrdeutig"|"belegt"} grund why it is not shown in a room (see IdBefund)
 * @property {object|null} raum the room that has this `_idx` today (`id:` keys) or that kept the `_idx` the GUID of a `guid:` key was
 *   derived from (a split room, final review F-W111802-FINAL-1, see eigenerRaum), else null
 * @property {number} imRaum how many furniture centres lie in `raum` (edge tolerance RAUM_TOLERANZ_M); 0 without `raum`
 * @property {Array<object>} kandidaten model rooms whose outline holds every furniture centre — LISTED for the person, never preselected
 * @property {string|null} vorschlag zoneKey of the room of the `_idx` (`raum`) when the furniture evidence points to it: all centres in
 *   its outline (where the entry was shown before), all in its bounding rectangle (the app's own insertion point, review R-1) or more
 *   than half in its outline (review R-2); null otherwise, and null when the GUIDs show the `_idx` moved to another room (review R-3).
 *   A FOREIGN room is never proposed (review R-1): it is only named in `kandidaten`. A proposal is never applied without the person.
 */

/**
 * "Möbel ohne Raum" (W-1118-02): every orphaned entry with the reason and a proposal for the person to confirm. Entries the
 * migration is about to move ("sicher") are left out.
 * @param {Record<string, Array<object>>|null|undefined} moeblierung
 * @param {Array<object>} zones store zones of all storeys
 * @param {IdPruefOptionen} [opts] GUID evidence (review R-3); pass the same options as to migriereMoeblierung
 * @returns {MoebelOhneRaum[]}
 */
export function moebelOhneRaum(moeblierung, zones, opts) {
  const m = moeblierung || {};
  /** @type {MoebelOhneRaum[]} */
  const aus = [];
  for (const key of verwaisteKeys(m, zones)) {
    const items = m[key];
    // verwaisteKeys: a guid: key here is shown by no room — eintragPruefen looks for the room that kept its _idx (a split room)
    const p = key.startsWith("id:") || key.startsWith("guid:") ? eintragPruefen(m, key, zones, opts)
      : { grund: "kein-raum", raum: null, kandidaten: kandidatenFuer(items, zones, null), umnummeriert: false };
    if (p.grund === "sicher" || p.grund === "ohne-guid") continue;
    const imRaum = p.raum ? anzahlImUmriss(items, p.raum) : 0;
    const vorschlag = p.raum && !p.umnummeriert && lageBelegt(items, p.raum) ? zoneKey(p.raum) : null;
    aus.push({ key, items, grund: /** @type {MoebelOhneRaum["grund"]} */ (p.grund), raum: p.raum, imRaum, kandidaten: p.kandidaten, vorschlag });
  }
  return aus;
}

/**
 * Puts "Möbel ohne Raum" entries into the rooms the person chose: each source entry is removed and its furniture appended
 * to the target room's list (under the target's key). Pure; unknown targets and missing sources are skipped.
 * @param {Record<string, Array<object>>|null|undefined} moeblierung
 * @param {Array<object>} zones store zones of all storeys
 * @param {Record<string, string>} zuordnung stored key of the entry → zoneKey of the target room
 * @returns {Record<string, Array<object>>} the new furnishing; the input itself when nothing was assigned
 */
export function ohneRaumZuweisen(moeblierung, zones, zuordnung) {
  const start = moeblierung || {};
  let out = start;
  for (const [key, zielKey] of Object.entries(zuordnung || {})) {
    const items = out[key];
    const ziel = (zones || []).find((z) => zoneKey(z) === zielKey);
    if (!Array.isArray(items) || !ziel || key === zielKey) continue;
    const rest = { ...out };
    delete rest[key];
    out = mitMoebelFuerZone(rest, ziel, [...moebelFuerZone(rest, ziel), ...items]);
  }
  return out;
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
