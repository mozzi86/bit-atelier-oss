// 91-01: rainwater harvesting (Regenwassernutzung) at concept level — yield from the catchment
// areas, demand for toilet flushing and garden irrigation, storage, the cistern UNDER the
// underground-garage slab, the dedicated building-services room for the plant, checks and
// quantities. User brief 10.10.2026: mandatory for the projects — all rainwater is collected and
// reused for toilets and garden irrigation, part of the sustainability concept, own
// building-services area for the plant.
//
// In:  catchment areas [{ art, m2 }] (roof, green roof, paved), annual precipitation (mm, from the
//      climate lookup in pflanzen.js or a fallback), units + persons per unit, garden area (m², the
//      site plan's green areas), garage usable area (m², tiefgarage.js) and the stored layer part
//      entwaesserung_layer.nutzung.
// Out: pure functions; units m², mm, l, m³, m³/a, %, m.
//
// Everything marked [ASSUMED] is a DIN 1989-1 concept rule of thumb (simplified method). A licensed
// plant design (DIN 1989-1/-2/-4, DIN EN 16941-1) replaces it; the checks are therefore pass / warn /
// offen only, never fail (same liability rule as Phase 63).

const num = (v, d = 0) => (v === null || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));
const rnd = (v, d = 1) => Math.round(num(v) * 10 ** d) / 10 ** d;

/**
 * Yield coefficients e per catchment type (DIN 1989-1 Tab. 1, Ertragsbeiwert) [ASSUMED values of the
 * table's usual ranges]. `label` is printed in the UI and the quantity list.
 * @type {Readonly<Record<string, {label: string, e: number}>>}
 */
export const ERTRAGSBEIWERTE = Object.freeze({
  steildach: { label: "Steildach (Ziegel, Blech)", e: 0.8 },
  flachdach: { label: "Flachdach bekiest", e: 0.6 },
  flachdachGlatt: { label: "Flachdach unbekiest", e: 0.8 },
  gruendachExtensiv: { label: "Gründach extensiv", e: 0.3 },
  gruendachIntensiv: { label: "Gründach intensiv", e: 0.1 },
  befestigt: { label: "befestigte Fläche (Pflaster)", e: 0.5 },
});

/** Hydraulic filter efficiency η (DIN 1989-1, 5.3) [ASSUMED 0,9]. */
export const FILTER_ETA = 0.9;
/** Fallback annual precipitation, mm/a [ASSUMED 650 — Franconian lowland; real value from the climate lookup]. */
export const NIEDERSCHLAG_FALLBACK_MM = 650;
/** Toilet flushing demand, l per person and day (DIN 1989-1 Tab. 3, household) [ASSUMED 24]. */
export const WC_L_JE_PERSON_TAG = 24;
/** Garden irrigation demand, l per m² and year (DIN 1989-1 Tab. 3) [ASSUMED 60]. */
export const GARTEN_L_JE_M2_JAHR = 60;
/** Dry period the store must bridge, days (simplified method) [ASSUMED 21]. */
export const TROCKENTAGE = 21;
/** Usable height of an in-situ concrete cistern under the garage slab, m [ASSUMED 1,5]. */
export const ZISTERNE_NUTZHOEHE_M = 1.5;
/** Persons per unit — same default as the TGA demand (hvac.js DEFAULT_PERSONEN_JE_WE) [ASSUMED A9]. */
export const PERSONEN_JE_WE = 2.5;

/** Overflow measures of a cistern below the backwater level. */
export const UEBERLAUF_MASSNAHMEN = Object.freeze({
  keine: { label: "keine gewählt" },
  hebeanlage: { label: "Überlauf über Hebeanlage (DIN EN 12056-4)" },
  rueckstauverschluss: { label: "Überlauf mit Rückstauverschluss + Geruchsverschluss (DIN 1989-1, 6.5)" },
  versickerung: { label: "Überlauf in Rigole/Versickerung (DWA-A 138)" },
});

/**
 * Stored layer part entwaesserung_layer.nutzung (91-01, additive — old layers without it get this).
 * `aktiv: true` by default: the user made rainwater harvesting mandatory for the projects (10.10.2026).
 * `flaechen: null` = catchment from the footprint + roof form; `gartenFlaeche_m2: null` = the site
 * plan's green areas.
 */
export const NUTZUNG_DEFAULT = Object.freeze({
  aktiv: true,
  flaechen: null,
  gartenFlaeche_m2: null,
  retentionInZisterne: false,
  ueberlaufMassnahme: "keine",
  wc: true,
  garten: true,
});

/**
 * Harden the stored nutzung part (unknown measure → "keine", areas filtered to known types and ≥ 0).
 * @param {any} n
 * @returns {{aktiv: boolean, flaechen: Array<{art: string, m2: number}>|null, gartenFlaeche_m2: number|null, retentionInZisterne: boolean, ueberlaufMassnahme: string, wc: boolean, garten: boolean}}
 */
export function nutzungHardened(n) {
  const o = n && typeof n === "object" ? n : {};
  const fl = Array.isArray(o.flaechen)
    ? o.flaechen.filter((f) => f && ERTRAGSBEIWERTE[f.art]).map((f) => ({ art: String(f.art), m2: Math.max(0, num(f.m2)) }))
    : null;
  return {
    aktiv: o.aktiv === undefined ? NUTZUNG_DEFAULT.aktiv : o.aktiv === true,
    flaechen: fl,
    gartenFlaeche_m2: o.gartenFlaeche_m2 === null || o.gartenFlaeche_m2 === undefined || o.gartenFlaeche_m2 === "" ? null : Math.max(0, num(o.gartenFlaeche_m2)),
    retentionInZisterne: o.retentionInZisterne === true,
    ueberlaufMassnahme: UEBERLAUF_MASSNAHMEN[o.ueberlaufMassnahme] ? String(o.ueberlaufMassnahme) : "keine",
    wc: o.wc === undefined ? true : o.wc === true,
    garten: o.garten === undefined ? true : o.garten === true,
  };
}

/**
 * Default catchment from the footprint area and roof form: pitched roof → steildach, flat roof →
 * flachdach (gravelled); a green-roof share turns that part into gruendachExtensiv.
 * @param {{footArea_m2?: number, dachform?: string, gruendachAnteil?: number}} p gruendachAnteil 0…1
 * @returns {Array<{art: string, m2: number}>}
 */
export function standardFlaechen({ footArea_m2 = 0, dachform = "flach", gruendachAnteil = 0 } = {}) {
  const A = Math.max(0, num(footArea_m2));
  const g = Math.min(1, Math.max(0, num(gruendachAnteil)));
  const dach = dachform === "flach" ? "flachdach" : "steildach";
  const out = [];
  if (A * (1 - g) > 0) out.push({ art: dach, m2: rnd(A * (1 - g)) });
  if (A * g > 0) out.push({ art: "gruendachExtensiv", m2: rnd(A * g) });
  return out;
}

/**
 * Annual yield (DIN 1989-1, 5.3): E = Σ A · e · η · N / 1000.
 * @param {{flaechen?: Array<{art: string, m2: number}>, niederschlag_mm?: number|null}} p
 * @returns {{m3a: number, niederschlag_mm: number, niederschlagGeschaetzt: boolean, je: Array<{art: string, label: string, m2: number, e: number, m3a: number}>}}
 */
export function ertrag({ flaechen = [], niederschlag_mm = null } = {}) {
  const geschaetzt = !(num(niederschlag_mm) > 0);
  const N = geschaetzt ? NIEDERSCHLAG_FALLBACK_MM : num(niederschlag_mm);
  const je = (Array.isArray(flaechen) ? flaechen : [])
    .filter((f) => ERTRAGSBEIWERTE[f?.art] && num(f.m2) > 0)
    .map((f) => {
      const e = ERTRAGSBEIWERTE[f.art].e;
      return { art: f.art, label: ERTRAGSBEIWERTE[f.art].label, m2: rnd(f.m2), e, m3a: rnd((num(f.m2) * e * FILTER_ETA * N) / 1000) };
    });
  return { m3a: rnd(je.reduce((s, x) => s + x.m3a, 0)), niederschlag_mm: N, niederschlagGeschaetzt: geschaetzt, je };
}

/**
 * Annual service-water demand (DIN 1989-1, 5.4): toilets persons · l/d · 365, garden m² · l/(m²·a).
 * @param {{we?: number, personenJeWe?: number, gartenFlaeche_m2?: number, wc?: boolean, garten?: boolean}} p
 * @returns {{personen: number, wc_m3a: number, garten_m3a: number, gesamt_m3a: number}}
 */
export function bedarf({ we = 0, personenJeWe = PERSONEN_JE_WE, gartenFlaeche_m2 = 0, wc = true, garten = true } = {}) {
  const personen = rnd(Math.max(0, num(we)) * Math.max(0, num(personenJeWe, PERSONEN_JE_WE)));
  const wcM3 = wc ? rnd((personen * WC_L_JE_PERSON_TAG * 365) / 1000) : 0;
  const gartenM3 = garten ? rnd((Math.max(0, num(gartenFlaeche_m2)) * GARTEN_L_JE_M2_JAHR) / 1000) : 0;
  return { personen, wc_m3a: wcM3, garten_m3a: gartenM3, gesamt_m3a: rnd(wcM3 + gartenM3) };
}

/**
 * Storage volume (simplified method): V_N = min(E, B) · TROCKENTAGE / 365, rounded UP to whole m³,
 * plus the retention volume when the cistern also retains (rueckhalt_m3 from entwaesserung.ueberflutung).
 * Coverage = min(E, B) / B; drinking-water saving = min(E, B).
 * @param {{ertrag_m3a?: number, bedarf_m3a?: number, rueckhalt_m3?: number}} p
 * @returns {{nutz_m3: number, rueckhalt_m3: number, gesamt_m3: number, deckung: number|null, einsparung_m3a: number, begrenzt: "ertrag"|"bedarf"|null}}
 */
export function speicher({ ertrag_m3a = 0, bedarf_m3a = 0, rueckhalt_m3 = 0 } = {}) {
  const E = Math.max(0, num(ertrag_m3a)), B = Math.max(0, num(bedarf_m3a));
  const nutzbar = Math.min(E, B);
  const nutz = nutzbar > 0 ? Math.ceil((nutzbar * TROCKENTAGE) / 365) : 0;
  const rh = Math.max(0, Math.ceil(num(rueckhalt_m3)));
  return {
    nutz_m3: nutz,
    rueckhalt_m3: rh,
    gesamt_m3: nutz + rh,
    deckung: B > 0 ? rnd(nutzbar / B, 3) : null,
    einsparung_m3a: rnd(nutzbar),
    begrenzt: nutzbar <= 0 ? null : E < B ? "ertrag" : "bedarf",
  };
}

/**
 * The cistern: in-situ concrete tank UNDER the garage slab when a garage exists (user brief), else in
 * the ground. Plan area = volume / usable height; it must fit under the garage's usable area.
 * @param {{volumen_m3?: number, tgAktiv?: boolean, tgFlaeche_m2?: number|null, nutzhoehe_m?: number}} p
 * @returns {{lage: "unter_tg"|"erdreich", volumen_m3: number, grundflaeche_m2: number, nutzhoehe_m: number, passt: boolean|null, hoeheNoetig_m: number|null}}
 */
export function zisterne({ volumen_m3 = 0, tgAktiv = false, tgFlaeche_m2 = null, nutzhoehe_m = ZISTERNE_NUTZHOEHE_M } = {}) {
  const V = Math.max(0, num(volumen_m3));
  const h = Math.max(0.5, num(nutzhoehe_m, ZISTERNE_NUTZHOEHE_M));
  const A = rnd(V / h);
  const unterTg = tgAktiv === true;
  const tgA = num(tgFlaeche_m2);
  const passt = unterTg ? (tgA > 0 ? A <= tgA : null) : null;
  return {
    lage: unterTg ? "unter_tg" : "erdreich",
    volumen_m3: V, grundflaeche_m2: A, nutzhoehe_m: h,
    passt,
    hoeheNoetig_m: unterTg && tgA > 0 && passt === false ? rnd(V / tgA, 2) : null,
  };
}

/**
 * Building-services room for the rainwater plant — a room of its own, not the general basement
 * technical room (user brief). Size by store volume [ASSUMED 8 / 12 / 16 m²]; contents per DIN 1989-1
 * (filter, pump/booster, control, top-up module with free outlet). Noise source like keller.js "technik".
 * @param {number} volumen_m3
 * @returns {{name: string, m2: number, raumart: "laut", inhalt: string[]}}
 */
export function technikraumRegenwasser(volumen_m3) {
  const V = Math.max(0, num(volumen_m3));
  const m2 = V <= 10 ? 8 : V <= 50 ? 12 : 16;
  return {
    name: "Haustechnik Regenwasser", m2, raumart: "laut",
    inhalt: ["Filter (Zulauf)", "Pumpen-/Druckerhöhungsanlage", "Steuerung mit Füllstandsanzeige", "Trinkwasser-Nachspeisung mit freiem Auslauf (DIN EN 1717 AA/AB)", "Betriebswasser-Verteiler, gekennzeichnet"],
  };
}

/**
 * Concept checks — pass / warn / offen only (see file head).
 * @param {{aktiv?: boolean, tgAktiv?: boolean, ueberlaufMassnahme?: string, er?: ReturnType<typeof ertrag>, be?: ReturnType<typeof bedarf>, sp?: ReturnType<typeof speicher>, zi?: ReturnType<typeof zisterne>, gruendach_m2?: number}} p
 * @returns {Array<{key: string, label: string, status: "pass"|"warn"|"offen", detail: string}>}
 */
export function regenwasserChecks({ aktiv, tgAktiv = false, ueberlaufMassnahme = "keine", er = null, be = null, sp = null, zi = null, gruendach_m2 = 0 } = {}) {
  /** @type {Array<{key: string, label: string, status: "pass"|"warn"|"offen", detail: string}>} */
  const out = [];
  if (!aktiv) {
    out.push({ key: "rw_aktiv", label: "Regenwassernutzung", status: "warn", detail: "abgeschaltet — Projektvorgabe: Regenwasser für WC und Garten nutzen (Nachhaltigkeitskonzept)" });
    return out;
  }
  if (!er || er.m3a <= 0) out.push({ key: "rw_ertrag", label: "Ertrag", status: "offen", detail: "keine Auffangfläche — Dachfläche fehlt (Baukörper setzen)" });
  else out.push({ key: "rw_ertrag", label: "Ertrag", status: er.niederschlagGeschaetzt ? "warn" : "pass", detail: `${er.m3a} m³/a aus ${er.je.reduce((s, x) => s + x.m2, 0)} m² bei ${er.niederschlag_mm} mm/a${er.niederschlagGeschaetzt ? " (Niederschlag geschätzt — Standort/Klima laden)" : ""}` });
  if (!be || be.gesamt_m3a <= 0) out.push({ key: "rw_bedarf", label: "Bedarf", status: "offen", detail: "kein Bedarf — Wohneinheiten bzw. Gartenfläche fehlen" });
  else out.push({ key: "rw_bedarf", label: "Bedarf", status: "pass", detail: `WC ${be.wc_m3a} m³/a (${be.personen} Personen) + Garten ${be.garten_m3a} m³/a` });
  if (sp && sp.deckung !== null) {
    out.push(sp.deckung >= 0.5
      ? { key: "rw_deckung", label: "Deckungsgrad", status: "pass", detail: `${Math.round(sp.deckung * 100)} % des Betriebswassers aus Regenwasser, ${sp.einsparung_m3a} m³/a Trinkwasser gespart` }
      : { key: "rw_deckung", label: "Deckungsgrad", status: "warn", detail: `nur ${Math.round(sp.deckung * 100)} % — Auffangfläche zu klein für den Bedarf (Nachspeisung trägt den Rest)` });
  }
  if (num(gruendach_m2) > 0) out.push({ key: "rw_gruendach", label: "Gründach", status: "warn", detail: `${rnd(gruendach_m2)} m² Gründach mindern den Ertrag stark (e ≈ 0,3) — Zielkonflikt Retention ↔ Nutzung prüfen` });
  if (zi && zi.volumen_m3 > 0) {
    if (zi.lage === "unter_tg") {
      out.push(zi.passt === false
        ? { key: "rw_lage", label: "Zisterne unter der Tiefgarage", status: "warn", detail: `${zi.grundflaeche_m2} m² bei ${zi.nutzhoehe_m} m Höhe passen nicht unter die TG — Nutzhöhe ≥ ${zi.hoeheNoetig_m} m oder zweite Kammer` }
        : zi.passt === null
          ? { key: "rw_lage", label: "Zisterne unter der Tiefgarage", status: "offen", detail: "TG-Fläche unbekannt — Tiefgarage in der Werkstatt planen" }
          : { key: "rw_lage", label: "Zisterne unter der Tiefgarage", status: "pass", detail: `${zi.volumen_m3} m³, ${zi.grundflaeche_m2} m² × ${zi.nutzhoehe_m} m unter der Bodenplatte — Auftrieb/Grundwasser mit dem Tragwerk klären` });
    } else {
      out.push({ key: "rw_lage", label: "Zisterne", status: tgAktiv ? "warn" : "pass", detail: `${zi.volumen_m3} m³ im Erdreich (keine Tiefgarage)` });
    }
    // Under the garage the cistern is always below the backwater level (street sewer) — its overflow
    // must not let sewage flow back (DIN 1989-1, 6.5; DIN EN 12056-4).
    if (zi.lage === "unter_tg") {
      out.push(ueberlaufMassnahme === "keine"
        ? { key: "rw_ueberlauf", label: "Überlauf unter der Rückstauebene", status: "warn", detail: "Zisterne liegt unter der Rückstauebene — Überlauf über Hebeanlage, Rückstauverschluss oder in eine Versickerung führen" }
        : { key: "rw_ueberlauf", label: "Überlauf unter der Rückstauebene", status: "pass", detail: UEBERLAUF_MASSNAHMEN[ueberlaufMassnahme].label });
    }
  }
  out.push({ key: "rw_nachspeisung", label: "Trinkwasser-Nachspeisung", status: "offen", detail: "nur mit freiem Auslauf Typ AA/AB (DIN EN 1717) — keine feste Verbindung Trinkwasser ↔ Betriebswasser" });
  out.push({ key: "rw_netz", label: "Betriebswassernetz", status: "offen", detail: "eigenes Leitungsnetz, Zapfstellen „Kein Trinkwasser“ kennzeichnen (TrinkwV § 17 Abs. 6), Anzeige beim Gesundheitsamt" });
  return out;
}

/**
 * Quantities for the AVA hand-over (91-03 wires them into the AVA).
 * Service-water pipe, rough: risers = ceil(WE / 8) [ASSUMED], each (storeys + 1) · storey height,
 * plus 30 m garden line when the garden is supplied [ASSUMED].
 * @param {{sp: ReturnType<typeof speicher>, zi: ReturnType<typeof zisterne>, raum: ReturnType<typeof technikraumRegenwasser>, we?: number, geschosse?: number, geschosshoehe_m?: number, garten?: boolean, ueberlaufMassnahme?: string}} p
 * @returns {Array<{key: string, label: string, menge: number, einheit: string}>}
 */
export function regenwasserMengen({ sp, zi, raum, we = 0, geschosse = 1, geschosshoehe_m = 3, garten = true, ueberlaufMassnahme = "keine" }) {
  if (!sp || sp.gesamt_m3 <= 0) return [];
  const steig = Math.max(1, Math.ceil(Math.max(0, num(we)) / 8));
  const lfm = rnd(steig * (Math.max(1, num(geschosse, 1)) + 1) * Math.max(2, num(geschosshoehe_m, 3)) + (garten ? 30 : 0));
  const out = [
    { key: "rw_zisterne", label: zi?.lage === "unter_tg" ? "Regenwasserzisterne Ortbeton unter TG-Bodenplatte" : "Regenwasserzisterne", menge: sp.gesamt_m3, einheit: "m³" },
    { key: "rw_zisterne_sohle", label: "Zisternensohle", menge: zi?.grundflaeche_m2 || 0, einheit: "m²" },
    { key: "rw_filter", label: "Regenwasserfilter (Zulauf)", menge: 1, einheit: "Stk." },
    { key: "rw_pumpe", label: "Regenwasser-Pumpenanlage mit Nachspeisung", menge: 1, einheit: "Stk." },
    { key: "rw_leitung", label: "Betriebswasserleitung (grob)", menge: lfm, einheit: "m" },
    { key: "rw_technikraum", label: raum?.name || "Haustechnik Regenwasser", menge: raum?.m2 || 0, einheit: "m²" },
  ];
  if (ueberlaufMassnahme === "hebeanlage") out.push({ key: "rw_hebeanlage", label: "Hebeanlage Zisternenüberlauf", menge: 1, einheit: "Stk." });
  if (ueberlaufMassnahme === "rueckstauverschluss") out.push({ key: "rw_rueckstau", label: "Rückstauverschluss Zisternenüberlauf", menge: 1, einheit: "Stk." });
  return out;
}

/**
 * Everything at once for the panel (91-02) and the tests.
 * @param {{nutzung?: any, footArea_m2?: number, dachform?: string, gruendachAnteil?: number, niederschlag_mm?: number|null,
 *   we?: number, personenJeWe?: number, gruenflaeche_m2?: number, tgAktiv?: boolean, tgFlaeche_m2?: number|null,
 *   rueckhalt_m3?: number, geschosse?: number, geschosshoehe_m?: number}} p
 *   gruenflaeche_m2 = the site plan's green areas (used when nutzung.gartenFlaeche_m2 is null);
 *   rueckhalt_m3 = required retention (entwaesserung.ueberflutung), added only with retentionInZisterne
 */
export function regenwasserNutzung(p = {}) {
  const n = nutzungHardened(p.nutzung);
  const flaechen = n.flaechen ?? standardFlaechen({ footArea_m2: p.footArea_m2, dachform: p.dachform, gruendachAnteil: p.gruendachAnteil });
  const gartenFlaeche = n.gartenFlaeche_m2 ?? Math.max(0, num(p.gruenflaeche_m2));
  const er = ertrag({ flaechen, niederschlag_mm: p.niederschlag_mm ?? null });
  const be = bedarf({ we: p.we, personenJeWe: p.personenJeWe, gartenFlaeche_m2: gartenFlaeche, wc: n.wc, garten: n.garten });
  const sp = speicher({ ertrag_m3a: er.m3a, bedarf_m3a: be.gesamt_m3a, rueckhalt_m3: n.retentionInZisterne ? p.rueckhalt_m3 : 0 });
  const zi = zisterne({ volumen_m3: sp.gesamt_m3, tgAktiv: p.tgAktiv, tgFlaeche_m2: p.tgFlaeche_m2 ?? null });
  const raum = technikraumRegenwasser(sp.gesamt_m3);
  const gruendach_m2 = flaechen.filter((f) => f.art === "gruendachExtensiv" || f.art === "gruendachIntensiv").reduce((s, f) => s + f.m2, 0);
  const checks = regenwasserChecks({ aktiv: n.aktiv, tgAktiv: p.tgAktiv, ueberlaufMassnahme: n.ueberlaufMassnahme, er, be, sp, zi, gruendach_m2 });
  const mengen = n.aktiv ? regenwasserMengen({ sp, zi, raum, we: p.we, geschosse: p.geschosse, geschosshoehe_m: p.geschosshoehe_m, garten: n.garten && gartenFlaeche > 0, ueberlaufMassnahme: n.ueberlaufMassnahme }) : [];
  return { nutzung: n, flaechen, gartenFlaeche_m2: gartenFlaeche, ertrag: er, bedarf: be, speicher: sp, zisterne: zi, technikraum: raum, checks, mengen };
}

/**
 * 91-02: plan outline of the cistern under the garage — a rectangle of `grundflaeche_m2`, centred in
 * the bounding box of the garage zones and with the box's aspect ratio (it lies under the slab, the
 * exact position is the structural engineer's call). Clamped to the box; null without zones or area.
 * @param {Array<{points?: Array<{x: number, z: number}>}>} tgZonen garage zones (tiefgarageLayout().zonen), m
 * @param {number} grundflaeche_m2 cistern plan area, m²
 * @returns {Array<{x: number, z: number}>|null} four corners, m
 */
export function zisternenRechteck(tgZonen, grundflaeche_m2) {
  const pts = (Array.isArray(tgZonen) ? tgZonen : []).flatMap((z) => (Array.isArray(z?.points) ? z.points : []));
  const A = Math.max(0, num(grundflaeche_m2));
  if (pts.length < 3 || A <= 0) return null;
  const xs = pts.map((p) => num(p.x)), zs = pts.map((p) => num(p.z));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const W = x1 - x0, D = z1 - z0;
  if (W <= 0 || D <= 0) return null;
  const k = Math.min(1, Math.sqrt(A / (W * D)));
  const w = W * k, d = D * k, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  return [{ x: cx - w / 2, z: cz - d / 2 }, { x: cx + w / 2, z: cz - d / 2 }, { x: cx + w / 2, z: cz + d / 2 }, { x: cx - w / 2, z: cz + d / 2 }];
}

/**
 * 91-02: number of units from the applied apartment layout — distinct `we` ids of the room zones at
 * level ≥ 0 (basement compartments at −1 carry the unit too and must not count twice). This is the
 * real count once the Werkstatt layout is applied; callers fall back to their concept value when it
 * is 0. A row-house unit spans several storeys under ONE id, so it counts once.
 * @param {Array<{we?: string|null, level?: number}>} zonen store zones (useBuildingProgram().zones)
 * @returns {number} units
 */
export function weAusZonen(zonen) {
  const ids = new Set();
  for (const z of Array.isArray(zonen) ? zonen : []) {
    if (z && typeof z.we === "string" && z.we && num(z.level) >= 0) ids.add(z.we);
  }
  return ids.size;
}
