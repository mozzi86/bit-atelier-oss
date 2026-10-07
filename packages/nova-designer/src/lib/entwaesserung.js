// Drainage concept for the site and building (Phase 63, ENTW-01/02/04/05; Phase 48 merged in):
// sewage flow from the sanitary inputs, ground pipes from the TGA network (netz_layer, gewerk abwasser),
// backwater level with basement/garage coupling, DIN 1986-100 flood balance (simplified), emergency roof
// drainage, retention catalogue on the site-plan core, checks (pass/warn/offen — never fail) and quantities.
//
// In:  netz_layer (tgaNetz.js), entwaesserung_layer (below), panel inputs (WE, Sanitärobjekte/WE),
//      werkstatt_layer.keller/tiefgarage.aktiv, footprint + drawn areas (aussenanlagen_layer) for A_red.
// Out: pure functions; units l/s, l/(s·ha), m, m², m³, DU, %.
//
// Everything with [ASSUMED] is a concept rule of thumb after DIN 1986-100 / DIN EN 12056-2 / DIN EN 13564 /
// DIN EN 12050 — a licensed drainage design replaces it, this tool only flags what a designer must look at.

import { netzHardened, kantenLaenge, KNOTEN_ARTEN } from "@designer/lib/tgaNetz";
import { abflussFlaeche, PSI_DACH, PSI_BEFESTIGT, PSI_GRUEN } from "@designer/lib/landscape";
import { layerHardened as lageplanHardened, flaechenSummen } from "@designer/lib/lageplan";

// null and "" must fall back to the DEFAULT, not to zero: Number(null) is 0 and passes
// isFinite, so a stored `kanalsohle_m: null` used to mean "sewer invert at ground level"
// and `r5_100: null` a rainfall intensity of 0 - both silently wrong instead of the
// documented default (found by the 63-01 unit test).
const num = (v, d = 0) => (v === null || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));
const rnd = (v, d = 2) => Math.round(num(v) * 10 ** d) / 10 ** d;
const naechsteId = (prefix, liste) => {
  let max = 0;
  for (const it of liste) { const m = new RegExp(`^${prefix}_(\\d+)$`).exec(String(it.id || "")); if (m) max = Math.max(max, Number(m[1])); }
  return `${prefix}_${max + 1}`;
};
const isPt = (p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.z));

// ---- Layer -------------------------------------------------------------------------------------------

/** Default entwaesserung_layer (one BimModel top-level field, KD-17). */
export const ENTW_DEFAULT = {
  rueckstau: { ebene_m: 0.0, massnahme: "keine", kanalsohle_m: -2.5 },
  regen: { r5_100: 800, r30_100: 300, qAb_ls: 5, dauer_min: 30 },
  dach: { ablaeufe: [], notueberlaeufe: [], gefaelle_pct: 2, dmin_m: 0.12 },
  rueckhalt: { elemente: [], flaechen: [] },
};
/** Backwater measures ([ASSUMED] mapping to DIN EN 13564 backwater valve / DIN EN 12050 lifting plant). */
export const RUECKSTAU_MASSNAHMEN = {
  keine: { label: "keine" },
  verschluss: { label: "Rückstauverschluss (DIN EN 13564)" },
  hebeanlage: { label: "Hebeanlage (DIN EN 12050)" },
};

/**
 * Harden a stored layer.
 * @param {object} layer
 */
export function layerHardened(layer) {
  const l = layer && typeof layer === "object" ? layer : {};
  const r = { ...ENTW_DEFAULT.rueckstau, ...(l.rueckstau || {}) };
  const g = { ...ENTW_DEFAULT.regen, ...(l.regen || {}) };
  const d = { ...ENTW_DEFAULT.dach, ...(l.dach || {}) };
  const pts = (arr, prefix) => (Array.isArray(arr) ? arr : []).filter(isPt).map((p, i) => ({ id: p.id || `${prefix}_${i + 1}`, x: rnd(p.x), z: rnd(p.z) }));
  return {
    ...l,
    rueckstau: { ebene_m: num(r.ebene_m), massnahme: RUECKSTAU_MASSNAHMEN[r.massnahme] ? r.massnahme : "keine", kanalsohle_m: num(r.kanalsohle_m, -2.5) },
    regen: { r5_100: Math.max(0, num(g.r5_100, 800)), r30_100: Math.max(0, num(g.r30_100, 300)), qAb_ls: Math.max(0, num(g.qAb_ls, 5)), dauer_min: Math.max(1, num(g.dauer_min, 30)) },
    dach: { ablaeufe: pts(d.ablaeufe, "ab"), notueberlaeufe: pts(d.notueberlaeufe, "no"), gefaelle_pct: Math.max(0.5, num(d.gefaelle_pct, 2)), dmin_m: Math.max(0.02, num(d.dmin_m, 0.12)) },
    rueckhalt: lageplanHardened(l.rueckhalt),
  };
}

/** Add a roof drain (`ablaeufe`) or emergency overflow (`notueberlaeufe`) at (x, z) metres. */
export function neuerDachpunkt(layer, liste, p) {
  const base = layerHardened(layer);
  if (!isPt(p) || !["ablaeufe", "notueberlaeufe"].includes(liste)) return { layer: base, punkt: null };
  const punkt = { id: naechsteId(liste === "ablaeufe" ? "ab" : "no", base.dach[liste]), x: rnd(p.x), z: rnd(p.z) };
  return { layer: { ...base, dach: { ...base.dach, [liste]: [...base.dach[liste], punkt] } }, punkt };
}

/** Move a roof point. */
export function verschiebeDachpunkt(layer, liste, id, p) {
  const base = layerHardened(layer);
  if (!isPt(p) || !base.dach[liste]) return base;
  return { ...base, dach: { ...base.dach, [liste]: base.dach[liste].map((q) => (q.id === id ? { ...q, x: rnd(p.x), z: rnd(p.z) } : q)) } };
}

/** Remove a roof point from either list. */
export function loescheDachpunkt(layer, id) {
  const base = layerHardened(layer);
  return { ...base, dach: { ...base.dach, ablaeufe: base.dach.ablaeufe.filter((q) => q.id !== id), notueberlaeufe: base.dach.notueberlaeufe.filter((q) => q.id !== id) } };
}

// ---- Schmutzwasser (DIN EN 12056-2) -----------------------------------------------------------------

/** Discharge coefficient K for dwellings (DIN EN 12056-2 Tab. 3: intermittent use 0.5). */
export const K_WOHNEN = 0.5;
/** [ASSUMED] mean design unit per sanitary object (WC 2.0, basin 0.5, shower 0.6, kitchen 0.8 → ≈ 1.0 DU). */
export const DU_MITTEL = 1.0;
/** Largest single DU — a WC (DIN EN 12056-2 Tab. 2); Q_ww may never be below it. */
export const DU_MAX = 2.0;
/**
 * Ground pipe sizing ([ASSUMED] after DIN 1986-100 Tab. 6/7 at 70 % filling): capacity at the listed minimum slope.
 * @type {Array<{dn:number, gefaelleMin_pct:number, qMax_ls:number}>}
 */
export const GRUNDLEITUNG_TABELLE = [
  { dn: 100, gefaelleMin_pct: 2.0, qMax_ls: 4.0 },
  { dn: 125, gefaelleMin_pct: 1.5, qMax_ls: 6.5 },
  { dn: 150, gefaelleMin_pct: 1.5, qMax_ls: 9.5 },
  { dn: 200, gefaelleMin_pct: 1.0, qMax_ls: 15.0 },
];

/** Table row for a DN (unknown DN → nearest larger row, above 200 → last row). */
export function grundleitungZeile(dn) {
  const d = num(dn);
  return GRUNDLEITUNG_TABELLE.find((z) => z.dn >= d) || GRUNDLEITUNG_TABELLE[GRUNDLEITUNG_TABELLE.length - 1];
}

/**
 * Sewage flow from the sanitary inputs.
 * @param {{ we?: number, sanitaerJeWe?: number }} p dwellings and sanitary objects per dwelling
 * @returns {{ sumDU: number, qww_ls: number, dn: number, gefaelleMin_pct: number }}
 */
export function schmutzwasser({ we = 0, sanitaerJeWe = 4 } = {}) {
  const sumDU = rnd(Math.max(0, num(we)) * Math.max(0, num(sanitaerJeWe)) * DU_MITTEL, 1);
  const qww = sumDU > 0 ? Math.max(DU_MAX, K_WOHNEN * Math.sqrt(sumDU)) : 0;
  const zeile = GRUNDLEITUNG_TABELLE.find((z) => z.qMax_ls >= qww) || GRUNDLEITUNG_TABELLE[GRUNDLEITUNG_TABELLE.length - 1];
  return { sumDU, qww_ls: rnd(qww), dn: zeile.dn, gefaelleMin_pct: zeile.gefaelleMin_pct };
}

// ---- Grundleitungen aus dem Netz ---------------------------------------------------------------------

/** [ASSUMED] frost-safe cover of a ground pipe leaving a slab-on-ground building (m below ground). */
export const FROSTTIEFE_M = 1.0;
/** [ASSUMED] pipe invert below a basement floor (m). */
export const SOHLE_UNTER_KELLER_M = 0.3;

/**
 * Sewage runs of the lowest storey that carries sewage edges = ground pipes. Slope per edge from the additive
 * `gefaelle_pct` or the table value of its DN; the longest chain of edge lengths gives the total drop, compared
 * with the sewer invert.
 * @param {object} netz netz_layer
 * @param {{ storeyHeight?: number, kellerAktiv?: boolean, kanalsohle_m?: number, dnDefault?: number }} [opts]
 * @returns {{ kanten: Array<{id:string, L_m:number, dn:number, gefaelle_pct:number, override:boolean, drop_m:number, level:number, von:string|null, nach:string|null}>, level: number|null, anschluss: object|null, laengsterStrang_m: number, dropGesamt_m: number, startsohle_m: number, endsohle_m: number, tiefeOk: boolean|null }}
 */
export function grundleitungen(netz, { storeyHeight = 3, kellerAktiv = false, kanalsohle_m = -2.5, dnDefault = 100 } = {}) {
  const n = netzHardened(netz);
  const ab = n.kanten.filter((k) => k.gewerk === "abwasser");
  const level = ab.length ? Math.min(...ab.map((k) => k.level)) : null;
  const kanten = ab.filter((k) => k.level === level).map((k) => {
    const dn = k.dn || dnDefault;
    const zeile = grundleitungZeile(dn);
    const override = k.gefaelle_pct != null;
    const gef = override ? k.gefaelle_pct : zeile.gefaelleMin_pct;
    const L = rnd(kantenLaenge(k.points));
    return { id: k.id, L_m: L, dn, gefaelle_pct: gef, override, drop_m: rnd(L * gef / 100, 3), level: k.level, von: k.von, nach: k.nach };
  });
  const anschluss = n.knoten.find((k) => k.gewerk === "abwasser" && k.art === "anschluss") || null;
  // Longest chain by summed length (edges form a tree towards the connection; a simple greedy walk suffices at concept level).
  const laengsterStrang_m = rnd(kanten.reduce((s, k) => s + k.L_m, 0));
  const dropGesamt_m = rnd(kanten.reduce((s, k) => s + k.drop_m, 0), 3);
  const startsohle_m = rnd(kellerAktiv ? -(num(storeyHeight, 3) + SOHLE_UNTER_KELLER_M) : -FROSTTIEFE_M);
  const endsohle_m = rnd(startsohle_m - dropGesamt_m);
  const tiefeOk = kanten.length ? endsohle_m >= num(kanalsohle_m, -2.5) : null;
  return { kanten, level, anschluss, laengsterStrang_m, dropGesamt_m, startsohle_m, endsohle_m, tiefeOk };
}

// ---- Rückstau -----------------------------------------------------------------------------------------

/**
 * Backwater check (DIN 1986-100 § 13): drainage fixtures below the backwater level need protection.
 * Basement (utility/laundry floor drain) and underground garage (ramp/floor drains) sit at storey −1.
 * warn, not fail: whether a room counts as "untergeordnet" is the designer's call.
 * @param {{ ebene_m?: number, massnahme?: string, kellerAktiv?: boolean, tiefgarageAktiv?: boolean, storeyHeight?: number }} p
 * @returns {{ status: "pass"|"warn", detail: string, gegenstaende: string[], sohle_m: number }}
 */
export function rueckstauCheck({ ebene_m = 0, massnahme = "keine", kellerAktiv = false, tiefgarageAktiv = false, storeyHeight = 3 } = {}) {
  const sohle = rnd(-num(storeyHeight, 3));
  const gegenstaende = [];
  if (kellerAktiv) gegenstaende.push("Keller (Bodenablauf Waschküche/Technik)");
  if (tiefgarageAktiv) gegenstaende.push("Tiefgarage (Rampen-/Bodenabläufe)");
  if (!gegenstaende.length || sohle >= num(ebene_m)) return { status: "pass", detail: "Keine Entwässerungsgegenstände unter der Rückstauebene", gegenstaende, sohle_m: sohle };
  if (massnahme === "hebeanlage") return { status: "pass", detail: `Hebeanlage (DIN EN 12050) hebt über die Rückstauebene ${num(ebene_m).toLocaleString("de-DE")} m`, gegenstaende, sohle_m: sohle };
  if (massnahme === "verschluss") {
    // [ASSUMED] backwater valves only for subordinate rooms with a WC above the level — never for garage drains.
    return tiefgarageAktiv
      ? { status: "warn", detail: "Rückstauverschluss für Tiefgaragenabläufe unzulässig — Hebeanlage vorsehen", gegenstaende, sohle_m: sohle }
      : { status: "pass", detail: "Rückstauverschluss (DIN EN 13564) — nur für untergeordnete Räume mit WC oberhalb der Rückstauebene", gegenstaende, sohle_m: sohle };
  }
  return { status: "warn", detail: `Sohle ${sohle.toLocaleString("de-DE")} m liegt unter der Rückstauebene ${num(ebene_m).toLocaleString("de-DE")} m — Rückstausicherung oder Hebeanlage wählen`, gegenstaende, sohle_m: sohle };
}

// ---- Regen: Überflutung, Notentwässerung, Rückhalt -----------------------------------------------------

/**
 * Runoff-effective area A_red (m²) from footprint and drawn areas (landscape.js coefficients).
 * @param {{ footArea?: number, befestigt_m2?: number, gruen_m2?: number }} p
 */
export function abflusswirksam({ footArea = 0, befestigt_m2 = 0, gruen_m2 = 0 } = {}) {
  return rnd(abflussFlaeche({ footArea, psiDach: PSI_DACH, stellplatzflaeche: befestigt_m2, psiBefestigt: PSI_BEFESTIGT, gruenflaeche: gruen_m2, psiGruen: PSI_GRUEN }), 1);
}

/**
 * Simplified flood-proof balance (DIN 1986-100 § 14.9.3): retention volume for the design storm.
 * V = (r · A_red / 10 000 − Q_ab) · D · 60 / 1 000.
 * @param {{ r30_100?: number, aRed?: number, qAb_ls?: number, dauer_min?: number }} p r in l/(s·ha), A_red m², Q_ab l/s, D min
 * @returns {{ zufluss_ls: number, vRueck_m3: number }}
 */
export function ueberflutung({ r30_100 = 300, aRed = 0, qAb_ls = 5, dauer_min = 30 } = {}) {
  const zufluss = num(r30_100) * num(aRed) / 10000;
  const v = Math.max(0, (zufluss - num(qAb_ls)) * num(dauer_min, 30) * 60 / 1000);
  return { zufluss_ls: rnd(zufluss), vRueck_m3: rnd(v, 1) };
}

/** [ASSUMED] free-flow capacity of a DN100 roof outlet (l/s). */
export const ABLAUF_DN100_LS = 4.5;
/** [ASSUMED] capacity of a parapet emergency overflow 300 × 100 mm at 35 mm head (l/s). */
export const NOTUEBERLAUF_LS = 15;

/**
 * Emergency roof drainage for the 5-minute centennial storm (DIN 1986-100 § 14.2.6): the overflows must take
 * what the outlets cannot.
 * @param {{ r5_100?: number, aDach?: number, nAblaeufe?: number, nNot?: number }} p
 * @returns {{ qDach_ls: number, qAblaeufe_ls: number, qNotErf_ls: number, qNotVorh_ls: number, status: "pass"|"warn"|"offen" }}
 */
export function notentwaesserung({ r5_100 = 800, aDach = 0, nAblaeufe = 0, nNot = 0 } = {}) {
  const qDach = rnd(num(r5_100) * num(aDach) / 10000);
  const qAbl = rnd(num(nAblaeufe) * ABLAUF_DN100_LS);
  const qNotErf = rnd(Math.max(0, qDach - qAbl));
  const qNotVorh = rnd(num(nNot) * NOTUEBERLAUF_LS);
  let status = "offen";
  if (aDach > 0 && nAblaeufe > 0) status = nNot > 0 && qNotVorh >= qNotErf ? "pass" : "warn";
  return { qDach_ls: qDach, qAblaeufe_ls: qAbl, qNotErf_ls: qNotErf, qNotVorh_ls: qNotVorh, status };
}

/**
 * Retention areas drawable on the site plan ([ASSUMED] storage per m²: swale 0.30 m depth, trench 1.0 m × 35 %
 * void ratio, swale-trench = both, retention roof 0.05 m). `gruen` marks unsealed surfaces for A_red.
 * @type {Record<string, { id: string, name: string, farbe: string, m3JeM2: number, gruen: boolean }>}
 */
export const REGEN_ARTEN = {
  mulde: { id: "mulde", name: "Mulde", farbe: "#93c5fd", m3JeM2: 0.30, gruen: true },
  rigole: { id: "rigole", name: "Rigole", farbe: "#a5b4fc", m3JeM2: 0.35, gruen: false },
  muldenrigole: { id: "muldenrigole", name: "Mulden-Rigole", farbe: "#818cf8", m3JeM2: 0.65, gruen: true },
  retentionsdach: { id: "retentionsdach", name: "Retentionsdach", farbe: "#6ee7b7", m3JeM2: 0.05, gruen: false },
};
/** Point elements (KatalogPanel format): cisterns with fixed volumes [ASSUMED 5/10/20 m³]. */
export const REGEN_KATALOG = [
  {
    gruppe: "Zisternen",
    typen: [
      { id: "zisterne5", name: "Zisterne 5 m³", volumen_m3: 5, radius_m: 1.0 },
      { id: "zisterne10", name: "Zisterne 10 m³", volumen_m3: 10, radius_m: 1.3 },
      { id: "zisterne20", name: "Zisterne 20 m³", volumen_m3: 20, radius_m: 1.7 },
    ],
  },
];
export const REGEN_TYPEN = Object.fromEntries(REGEN_KATALOG.flatMap((g) => g.typen.map((t) => [t.id, t])));

/**
 * Retention volume of the drawn elements.
 * @param {object} rueckhalt lageplan.js layer { elemente, flaechen }
 * @returns {{ je: Record<string, number>, gesamt_m3: number, zisternen: number }}
 */
export function rueckhaltVolumen(rueckhalt) {
  const l = lageplanHardened(rueckhalt);
  const s = flaechenSummen(l);
  const je = {};
  for (const [art, m2] of Object.entries(s)) { const a = REGEN_ARTEN[art]; if (a) je[art] = rnd(m2 * a.m3JeM2, 1); }
  let zist = 0, zisternen = 0;
  for (const e of l.elemente) { const t = REGEN_TYPEN[e.typ]; if (t) { zist += t.volumen_m3; zisternen += 1; } }
  if (zisternen) je.zisterne = rnd(zist, 1);
  return { je, gesamt_m3: rnd(Object.values(je).reduce((a, b) => a + b, 0), 1), zisternen };
}

// ---- Checks & Mengen -----------------------------------------------------------------------------------

/**
 * Concept checks — pass/warn/offen only: the drainage design is a licensed planner's proof, this is its
 * pre-check (T-17-04 rule).
 * @param {{ sw?: ReturnType<typeof schmutzwasser>, gl?: ReturnType<typeof grundleitungen>, rueckstau?: ReturnType<typeof rueckstauCheck>, bilanz?: ReturnType<typeof ueberflutung>, rueckhalt?: ReturnType<typeof rueckhaltVolumen>, not?: ReturnType<typeof notentwaesserung>, dachform?: string }} p
 * @returns {Array<{ key: string, label: string, status: "pass"|"warn"|"offen", detail: string }>}
 */
export function entwaesserungChecks({ sw = null, gl = null, rueckstau = null, bilanz = null, rueckhalt = null, not = null, dachform = "flach" } = {}) {
  const items = [];
  items.push(sw && sw.sumDU > 0
    ? { key: "schmutzwasser", label: "Schmutzwasser", status: "pass", detail: `ΣDU ${sw.sumDU} → Q_ww ${sw.qww_ls} l/s → Grundleitung DN ${sw.dn} bei ≥ ${sw.gefaelleMin_pct} %` }
    : { key: "schmutzwasser", label: "Schmutzwasser", status: "offen", detail: "Wohneinheiten/Sanitärobjekte im Konzept-Tab eingeben" });
  if (!gl || !gl.kanten.length) {
    items.push({ key: "grundleitung", label: "Grundleitungen", status: "offen", detail: "Keine Abwasser-Leitungen im Netz — im Sub-Tab „Netz“ (Gewerk Abwasser) zeichnen" });
  } else {
    const zuFlach = sw ? gl.kanten.filter((k) => k.dn < sw.dn || k.gefaelle_pct < grundleitungZeile(k.dn).gefaelleMin_pct) : [];
    items.push({ key: "grundleitung", label: "Grundleitungen", status: zuFlach.length ? "warn" : "pass", detail: zuFlach.length ? `${zuFlach.length} Leitung(en) unter DN/Mindestgefälle der Tabelle` : `${gl.kanten.length} Leitung(en), ${gl.laengsterStrang_m} m, Gefälle ${gl.dropGesamt_m} m` });
    items.push(gl.anschluss
      ? { key: "anschluss", label: "Kanalanschluss", status: gl.tiefeOk === false ? "warn" : "pass", detail: gl.tiefeOk === false ? `Leitungssohle ${gl.endsohle_m} m unter Kanalsohle — Hebeanlage oder Gefälle prüfen` : `Übergabe ${gl.anschluss.name || gl.anschluss.id}, Sohle ${gl.endsohle_m} m` }
      : { key: "anschluss", label: "Kanalanschluss", status: "offen", detail: "Knoten „Hausanschluss / Übergabe“ (Gewerk Abwasser) fehlt" });
  }
  if (rueckstau) items.push({ key: "rueckstau", label: "Rückstauebene", status: rueckstau.status, detail: rueckstau.detail });
  if (dachform !== "flach") {
    items.push({ key: "dach", label: "Dachentwässerung", status: "offen", detail: `Dachform „${dachform}“ — Gefälledämmung/Notentwässerung gelten für Flachdächer` });
  } else if (not) {
    items.push(not.status === "offen"
      ? { key: "not", label: "Notentwässerung", status: "offen", detail: "Abläufe auf dem Dach setzen" }
      : { key: "not", label: "Notentwässerung", status: not.status, detail: `r(5,100): ${not.qDach_ls} l/s Dach − ${not.qAblaeufe_ls} l/s Abläufe = ${not.qNotErf_ls} l/s erforderlich, ${not.qNotVorh_ls} l/s Notüberläufe` });
  }
  if (bilanz) {
    const vorh = rueckhalt?.gesamt_m3 || 0;
    items.push(bilanz.vRueck_m3 <= 0
      ? { key: "ueberflutung", label: "Überflutungsnachweis", status: "pass", detail: "Zufluss ≤ zulässiger Abfluss — kein Rückhalt nötig" }
      : vorh <= 0
        ? { key: "ueberflutung", label: "Überflutungsnachweis", status: "offen", detail: `${bilanz.vRueck_m3} m³ zurückhalten — Mulde/Rigole/Zisterne auf dem Lageplan setzen` }
        : { key: "ueberflutung", label: "Überflutungsnachweis", status: vorh >= bilanz.vRueck_m3 ? "pass" : "warn", detail: `${vorh} m³ Rückhalt vorhanden / ${bilanz.vRueck_m3} m³ erforderlich (DIN 1986-100, vereinfacht)` });
  }
  return items;
}

/**
 * Quantities for the AVA hand-over.
 * @param {{ gl?: ReturnType<typeof grundleitungen>, dach?: { ablaeufe: Array<object>, notueberlaeufe: Array<object> }, rueckstau?: { massnahme: string }, rueckhalt?: ReturnType<typeof rueckhaltVolumen>, gefaelleMengen?: Array<{key:string,label:string,menge:number,einheit:string}> }} p
 * @returns {Array<{ key: string, label: string, menge: number, einheit: string }>}
 */
export function entwaesserungMengen({ gl = null, dach = null, rueckstau = null, rueckhalt = null, gefaelleMengen = [] } = {}) {
  const out = [];
  if (gl) {
    const jeDn = new Map();
    for (const k of gl.kanten) jeDn.set(k.dn, (jeDn.get(k.dn) || 0) + k.L_m);
    for (const [dn, L] of [...jeDn.entries()].sort((a, b) => a[0] - b[0])) out.push({ key: `gl_dn${dn}`, label: `Grundleitung DN ${dn}`, menge: rnd(L, 1), einheit: "m" });
  }
  if (dach) {
    if (dach.ablaeufe.length) out.push({ key: "ablaeufe", label: "Dachabläufe DN 100", menge: dach.ablaeufe.length, einheit: "Stk." });
    if (dach.notueberlaeufe.length) out.push({ key: "notueberlaeufe", label: "Notüberläufe (Attika)", menge: dach.notueberlaeufe.length, einheit: "Stk." });
  }
  if (rueckstau?.massnahme === "hebeanlage") out.push({ key: "hebeanlage", label: "Hebeanlage", menge: 1, einheit: "Stk." });
  if (rueckstau?.massnahme === "verschluss") out.push({ key: "verschluss", label: "Rückstauverschluss", menge: 1, einheit: "Stk." });
  if (rueckhalt) {
    for (const [art, m3] of Object.entries(rueckhalt.je)) out.push({ key: `rh_${art}`, label: art === "zisterne" ? `Zisternen (${rueckhalt.zisternen} Stk.)` : `${REGEN_ARTEN[art]?.name || art} (Speicher)`, menge: m3, einheit: "m³" });
  }
  for (const m of gefaelleMengen) out.push(m);
  return out;
}
