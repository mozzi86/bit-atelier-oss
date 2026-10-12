// Sample data of phase 81 (time, fees, controlling) for the Express development
// database (server/seed.js), built ON TOP of the 79 accounting sample (contracts
// bsp-hv-1…4, HoaiPlan proj-1/proj-2) and — when given — the 80 personnel sample.
// Since 83-02 there is no browser demo any more, so nothing seeds a browser; this
// module is the developer data and the fixture of the unit tests.
//
// Always relative to "today" and deterministic: the same `heute` and the same
// input give the same records (ids "bsp-zh-*", every record `beispiel: true`).
// Only invented names (tests/unit/projektneutral.test.js scans this file).
//
// The time bookings are calibrated so that the controlling of 81-05 shows the
// three traffic lights on the 79 sample (81-RESEARCH § Demo-Saat):
//   proj-1, "amber stage" (highest 0 < F < 100, built: LPH 5 at 80 %): V − F ≈ +7,5 pp
//   proj-1, "green stage" (next stage with F > 0, built: LPH 6 at 45 %): V − F ≈ −5 pp
//   proj-2, running stage (built: LPH 3 at 90 %):                        V − F ≈ +15 pp
// with V = K / H (K = Σ minutes × cost rate, H = the stage's fee of 79's
// honorarVertrag). Eight calendar weeks before the current week carry realistic
// daily bookings (at most 9 h per person and day, Bavarian working days only); the
// hours before that window come as ONE import booking per stage and person
// ("Übertrag vor dem Beispielzeitraum"), otherwise the cumulative effort of a
// running stage would not fit into eight weeks.
//
// Kept free for phase 82 (absences): M1 in the weeks −7/−6, M3 on Monday/Tuesday
// of week −2. Status: up to week −2 approved (by M1), week −1 submitted, current
// week empty.
//
// In:  heute 'YYYY-MM-DD'; {buchhaltung: output of 79's beispielDatensaetze(heute),
//      personal: {Mitarbeiter, Arbeitsvertrag, Gehaltsaenderung} of phase 80 or
//      nothing}. Out: records per entity plus the patches for 79 records.
//
// Relative imports only (no "@core"/"@" alias): server/seed.js loads this file
// with plain node, without the alias hook.

import { honorarVertrag } from "../../../packages/nova-core/src/lib/hoai/honorar.js";
import { leistungsbildInfo } from "../../../packages/nova-core/src/lib/hoai/leistungsbilder.js";
import { isoWoche, plusMonate, plusTage, wochentag } from "../../../packages/nova-core/src/lib/kalender/datum.js";
import { feiertage, KALENDER_STANDARD } from "../../../packages/nova-core/src/lib/kalender/feiertage.js";
import { satzAusGehalt } from "../controlling/kostensatz.js";

/** Reference day of the SEED_* constants below. */
export const SEED_REFERENZ_HEUTE = "2026-09-28";

/** Rule values the sample cost rates are computed with (standards of zeit_honorar.*, E-16). */
export const SEED_REGELWERTE = Object.freeze({ ag_anteil: 21, gemeinkosten: 80, produktivquote: 85, feiertage: 13, krankheitstage: 10 });

/** Manual cost rate of the owner in Euro/hour [ASSUMED sample value]. */
export const SEED_SATZ_INHABER = 115;

// Figures of the sample on SEED_REFERENZ_HEUTE — once with an empty personnel store
// (Express without 80 data: only the virtual owner, E-17), once with the 80 sample
// personalSeed.json (P-001 owner, P-003 employee, P-004 working student).
// tests/unit/zeitHonorarBeispiel.test.js recomputes them; the plans 81-02…81-06 and
// their E2E specs read them instead of repeating numbers.

/** Number of time bookings. */
export const SEED_ZEITBUCHUNGEN = Object.freeze({ solo: 43, team: 106 });
/** Minutes per person in the week before the reference week (2026-W39, status submitted). */
export const SEED_MINUTEN_WOCHE_MINUS1 = Object.freeze({ solo: Object.freeze({ inhaber: 2400 }), team: Object.freeze({ "P-001": 1920, "P-003": 1800, "P-004": 855 }) });
/** Cost rates of the team sample in Euro/hour (owner manual, the others from salary and contract). */
export const SEED_KOSTENSAETZE_TEAM = Object.freeze({ "P-001": 115, "P-003": 77.24, "P-004": 46.05 });
/** Office rate of the team sample = mean of the three rates (Euro/hour). */
export const SEED_BUEROSATZ_TEAM = 79.43;
/** The three calibrated stages and the traffic light the controlling must show. */
export const SEED_AMPELN = Object.freeze([
  Object.freeze({ schluessel: "gelb", project_id: "proj-1", lph: 5, ampel: "gelb" }),
  Object.freeze({ schluessel: "gruen", project_id: "proj-1", lph: 6, ampel: "gruen" }),
  Object.freeze({ schluessel: "rot", project_id: "proj-2", lph: 3, ampel: "rot" }),
]);
/** The open fee offer of proj-3 (Fixture D: interiors, 480.000 €, zone III, LPH 1–8). */
export const SEED_ANGEBOT_OFFEN = Object.freeze({ id: "bsp-zh-ha-neu", nummer: "HA-2026-001", netto: 62365.74, gueltig_bis: "2026-10-09" });

/** Targets of V − F in percentage points (81-RESEARCH § Demo-Saat). */
const ZIEL_ABSTAND = Object.freeze({ gelb: 7.5, gruen: -5, rot: 15 });

/** Share of a stage's target cost booked inside the eight-week window; the rest is carried over. */
const FENSTER_ANTEIL = 0.4;

const bsp = Object.freeze({ beispiel: true });

/** @param {number} x minutes @returns {number} rounded to the 15-minute grid */
const raster15 = (x) => Math.max(0, Math.round(x / 15) * 15);
/** @param {number} x minutes @returns {number} rounded DOWN to the 15-minute grid */
const raster15ab = (x) => Math.max(0, Math.floor(x / 15) * 15);
/** @param {number} x Euro @returns {number} cents-rounded */
const rund2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

/**
 * @param {string} tag 'YYYY-MM-DD'
 * @returns {string} 'YYYY-Www'
 */
function kwVon(tag) {
  const w = /** @type {{jahr: number, woche: number}} */ (isoWoche(tag));
  return `${w.jahr}-W${String(w.woche).padStart(2, "0")}`;
}

/**
 * Active contract like 80's aktiverVertrag (status signed or terminated, started,
 * not ended; the latest start wins) — repeated here because this file must load
 * without the alias hook (src/lib/people/vertrag.js is not reachable relatively
 * through the app alias). Same rule, tested against 80 in zeitHonorarBeispiel.test.js.
 * @param {any[]} vertraege
 * @param {string} id
 * @param {string} tag
 * @returns {any|null}
 */
function vertragAm(vertraege, id, tag) {
  const k = (vertraege || []).filter((v) => v?.mitarbeiter_id === id && (v.status === "unterschrieben" || v.status === "gekuendigt")
    && typeof v.beginn === "string" && v.beginn <= tag && (!v.ende || tag <= v.ende));
  return k.length ? k.reduce((a, b) => (b.beginn > a.beginn ? b : a)) : null;
}

/**
 * Salary on a day like 80's gehaltAm (latest gueltig_ab ≤ day).
 * @param {any[]} gehaelter
 * @param {string} id
 * @param {string} tag
 * @returns {any|null}
 */
function gehaltAm(gehaelter, id, tag) {
  const k = (gehaelter || []).filter((g) => g?.mitarbeiter_id === id && typeof g.gueltig_ab === "string" && g.gueltig_ab <= tag);
  return k.length ? k.reduce((a, b) => (b.gueltig_ab > a.gueltig_ab ? b : a)) : null;
}

/**
 * The three sample persons: M1 owner (real record or the virtual "inhaber",
 * E-17), M2 first active employee (project lead on proj-1 preferred), M3 the next
 * active person with a contract (in the 80 sample the working student).
 * @param {{Mitarbeiter?: any[], Arbeitsvertrag?: any[], Gehaltsaenderung?: any[]}} personal
 * @param {string} heute
 * @returns {Array<{rolle: 'M1'|'M2'|'M3', id: string, satz: number, herkunft: 'manuell'|'berechnet', basis: any, tagesMinuten: number, tage: number[]}>}
 */
function personenWaehlen(personal, heute) {
  const mitarbeiter = (personal?.Mitarbeiter || []).filter((m) => m && m.status === "aktiv");
  const vertraege = personal?.Arbeitsvertrag || [];
  const gehaelter = personal?.Gehaltsaenderung || [];
  const inhaber = mitarbeiter.find((m) => m.art === "inhaber");
  /** @type {any[]} */
  const aus = [{ rolle: "M1", id: inhaber ? inhaber.id : "inhaber", satz: SEED_SATZ_INHABER, herkunft: "manuell", basis: null, tagesMinuten: 480, tage: [1, 2, 3, 4, 5] }];
  const mitSatz = (m, rolle) => {
    const vertrag = vertragAm(vertraege, m.id, heute);
    const gehalt = gehaltAm(gehaelter, m.id, heute);
    const r = vertrag && gehalt ? satzAusGehalt({ gehalt, vertrag, personArt: m.art }, SEED_REGELWERTE) : null;
    if (!r) return null;
    const at = Number(vertrag.arbeitstage_woche) || 5;
    // Contract days = the first `at` weekdays (same [ASSUMED] rule as sollMinuten).
    return { rolle, id: m.id, satz: r.satz_eur_h, herkunft: "berechnet", basis: r.basis, tagesMinuten: raster15ab((Number(vertrag.wochenstunden) * 60) / at), tage: [1, 2, 3, 4, 5].slice(0, at) };
  };
  const angestellte = mitarbeiter.filter((m) => m.art === "angestellt");
  const pl = angestellte.find((m) => (m.projekt_zuordnungen || []).some((z) => z?.project_id === "proj-1" && /projektleit/i.test(String(z.funktion || ""))));
  const m2 = pl || angestellte.find((m) => mitSatz(m, "M2"));
  const m2Satz = m2 ? mitSatz(m2, "M2") : null;
  if (m2Satz) aus.push(m2Satz);
  const m3 = mitarbeiter.find((m) => m !== inhaber && m !== m2 && m.art !== "inhaber" && m.art !== "gesellschafter" && mitSatz(m, "M3"));
  const m3Satz = m3 ? mitSatz(m3, "M3") : null;
  if (m3Satz) aus.push(m3Satz);
  return aus;
}

/**
 * Sample records of phase 81 relative to `heute`.
 * @param {string} heute 'YYYY-MM-DD'
 * @param {{buchhaltung: Record<string, any[]>, personal?: {Mitarbeiter?: any[], Arbeitsvertrag?: any[], Gehaltsaenderung?: any[]}|null}} quellen
 * @returns {{
 *   Zeitbuchung: any[], Arbeitszeit: any[], Honorarangebot: any[], Honorarnachtrag: any[],
 *   Kostensatz: any[], honorarvertragPatch: Record<string, any>, hoaiPlanVerlauf: Record<string, any[]>,
 *   ziele: Array<{schluessel: string, project_id: string, lph: number, H: number, F: number, K: number}>,
 * }} Kostensatz rows belong to the personnel storage class (the caller decides whether it may write them)
 */
export function beispielDatensaetzeZeitHonorar(heute, { buchhaltung, personal = null }) {
  if (typeof heute !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(heute)) throw new Error(`Beispieldaten Zeit & Honorar: ungültiges Datum „${heute}“.`);
  const Y = Number(heute.slice(0, 4));
  const vertraege = buchhaltung?.Honorarvertrag || [];
  const plaene = buchhaltung?.HoaiPlan || [];
  const vertrag = (id) => vertraege.find((v) => v.id === id);
  const hv1 = vertrag("bsp-hv-1");
  const hv2 = vertrag("bsp-hv-2");
  if (!hv1 || !hv2) throw new Error("Beispieldaten Zeit & Honorar brauchen die 79-Saat (bsp-hv-1, bsp-hv-2).");
  const fortschritt = (projekt) => plaene.find((p) => p.project_id === projekt)?.progress || [];
  const personen = personenWaehlen(personal || {}, heute);
  const m1 = personen[0];

  // --- Stages and their target cost -------------------------------------------------
  const p1 = fortschritt("proj-1");
  const p2 = fortschritt("proj-2");
  const laufend = (prog) => prog.reduce((best, f, i) => (typeof f === "number" && f > 0 && f < 100 && (best < 0 || f > prog[best]) ? i : best), -1);
  const gelbI = laufend(p1);
  const gruenI = p1.findIndex((f, i) => i > gelbI && typeof f === "number" && f > 0);
  const rotI = laufend(p2);
  const h1 = honorarVertrag(hv1);
  const h2 = honorarVertrag(hv2);
  // H_i = stage amount × (1 + umbau/grund) — the controlling's fee per stage without incidental costs.
  const hStufe = (h, i) => rund2(h.lph[i].betrag * (1 + (h.grund ? (h.umbau || 0) / h.grund : 0)));
  const ziele = [
    { schluessel: "gelb", project_id: "proj-1", vertrag: hv1, lph: gelbI + 1, H: hStufe(h1, gelbI), F: p1[gelbI] / 100 },
    { schluessel: "gruen", project_id: "proj-1", vertrag: hv1, lph: gruenI + 1, H: hStufe(h1, gruenI), F: p1[gruenI] / 100 },
    { schluessel: "rot", project_id: "proj-2", vertrag: hv2, lph: rotI + 1, H: hStufe(h2, rotI), F: p2[rotI] / 100 },
  ].map((z) => ({ ...z, K: rund2(z.H * (z.F + ZIEL_ABSTAND[/** @type {'gelb'|'gruen'|'rot'} */ (z.schluessel)] / 100)) }));

  // --- Window: eight calendar weeks before the current week ----------------------------
  const wt = /** @type {number} */ (wochentag(heute));
  const montagHeute = /** @type {string} */ (plusTage(heute, -((wt === 0 ? 7 : wt) - 1)));
  const fei = new Set([...feiertage(Y - 1, KALENDER_STANDARD), ...feiertage(Y, KALENDER_STANDARD)].map((f) => f.datum));
  /** @type {any[]} */
  const buchungen = [];
  let nr = 0;
  const id = () => `bsp-zh-zb-${String(++nr).padStart(4, "0")}`;
  const statusFuer = (woche, freitag) => (woche <= -2
    ? { status: "freigegeben", eingereicht_am: `${freitag}T16:00:00.000Z`, freigegeben_von: m1.id, freigegeben_am: `${plusTage(freitag, 3)}T09:00:00.000Z` }
    : { status: "eingereicht", eingereicht_am: `${freitag}T16:00:00.000Z`, freigegeben_von: null, freigegeben_am: null });
  /** remaining window budget per stage (Euro) */
  const budget = Object.fromEntries(ziele.map((z) => [z.schluessel, z.K * FENSTER_ANTEIL]));
  /** booked cost per stage (Euro) */
  const kosten = Object.fromEntries(ziele.map((z) => [z.schluessel, 0]));

  /**
   * Whether a person books on a day of the window (contract days, Bavarian
   * working days, the slots kept free for phase 82).
   * @param {{rolle: string, tage: number[]}} p
   * @param {number} woche −8 … −1
   * @param {number} wochentagNr 1 = Monday … 5 = Friday
   * @param {string} tag 'YYYY-MM-DD'
   */
  const arbeitet = (p, woche, wochentagNr, tag) => !fei.has(tag) && p.tage.includes(wochentagNr)
    && !(p.rolle === "M1" && (woche === -7 || woche === -6))
    && !(p.rolle === "M3" && woche === -2 && wochentagNr <= 2);
  // Spread the window budget evenly over the eight weeks: every person books the
  // same share f of a full day, so week −1 carries hours too.
  let kapazitaet = 0;
  for (let woche = -8; woche <= -1; woche++) {
    for (let d = 0; d < 5; d++) {
      const tag = /** @type {string} */ (plusTage(montagHeute, woche * 7 + d));
      for (const p of personen) if (arbeitet(p, woche, d + 1, tag)) kapazitaet += (p.tagesMinuten / 60) * p.satz;
    }
  }
  const gesamtBudget = Object.values(budget).reduce((a, b) => a + b, 0);
  const anteil = kapazitaet > 0 ? Math.min(1, gesamtBudget / kapazitaet) : 0;

  for (let woche = -8; woche <= -1; woche++) {
    const montag = /** @type {string} */ (plusTage(montagHeute, woche * 7));
    const freitag = /** @type {string} */ (plusTage(montag, 4));
    for (let d = 0; d < 5; d++) {
      const tag = /** @type {string} */ (plusTage(montag, d));
      const wochentagNr = d + 1; // 1 = Monday
      for (const p of personen) {
        if (!arbeitet(p, woche, wochentagNr, tag)) continue;
        let frei = Math.min(p.tagesMinuten, 540);
        const basis = { mitarbeiter_id: p.id, datum: tag, monat: tag.slice(0, 7), kw: kwVon(tag), quelle: "manuell", notiz: "", ...statusFuer(woche, freitag), ablehnung_grund: null, ...bsp };
        // Owner: office administration on Fridays (2 h, 40 h over the window) and acquisition for proj-3 (weeks −5/−4, Tue/Thu 3 h → 12 h).
        if (p.rolle === "M1" && wochentagNr === 5) {
          buchungen.push({ ...basis, id: id(), project_id: null, lph: null, leistung: null, honorarnachtrag_id: null, kategorie_intern: "verwaltung", minuten: 120 });
          frei -= 120;
        }
        if (p.rolle === "M1" && (woche === -5 || woche === -4) && (wochentagNr === 2 || wochentagNr === 4)) {
          buchungen.push({ ...basis, id: id(), project_id: "proj-3", lph: null, leistung: "akquise", honorarnachtrag_id: null, kategorie_intern: null, minuten: 180, notiz: "Honorarangebot Gemeinschaftshaus" });
          frei -= 180;
        }
        // Project hours: share f of the day, to the stage with the largest remaining window budget.
        frei = Math.min(frei, raster15(p.tagesMinuten * anteil));
        while (frei >= 15) {
          const z = ziele.filter((x) => budget[x.schluessel] >= (15 / 60) * p.satz).sort((a, b) => budget[b.schluessel] - budget[a.schluessel])[0];
          if (!z) break;
          const minuten = Math.min(frei, raster15ab((budget[z.schluessel] / p.satz) * 60));
          if (minuten < 15) break;
          buchungen.push({ ...basis, id: id(), project_id: z.project_id, lph: z.lph, leistung: "grund", honorarnachtrag_id: null, kategorie_intern: null, minuten });
          const k = (minuten / 60) * p.satz;
          budget[z.schluessel] -= k;
          kosten[z.schluessel] += k;
          frei -= minuten;
        }
      }
    }
  }

  // --- Carry-over before the window: one import booking per stage (owner) ------------------
  const vorFenster = /** @type {string} */ (plusTage(montagHeute, -9 * 7));
  for (const z of ziele) {
    const rest = z.K - kosten[z.schluessel];
    const minuten = raster15((rest / m1.satz) * 60);
    if (minuten <= 0) continue;
    buchungen.push({
      id: id(), mitarbeiter_id: m1.id, project_id: z.project_id, lph: z.lph, leistung: "grund", honorarnachtrag_id: null, kategorie_intern: null,
      datum: vorFenster, monat: vorFenster.slice(0, 7), kw: kwVon(vorFenster), minuten, notiz: "Übertrag vor dem Beispielzeitraum", quelle: "import",
      status: "freigegeben", eingereicht_am: `${vorFenster}T16:00:00.000Z`, freigegeben_von: m1.id, freigegeben_am: `${vorFenster}T17:00:00.000Z`, ablehnung_grund: null, ...bsp,
    });
  }

  // --- Working day frame: M2 (else M1) in week −1, one day with 10,5 h net -------------------
  const rahmenPerson = personen.find((p) => p.rolle === "M2") || m1;
  const montagM1 = /** @type {string} */ (plusTage(montagHeute, -7));
  const Arbeitszeit = [0, 1, 2, 3, 4].map((d) => {
    const datum = /** @type {string} */ (plusTage(montagM1, d));
    const lang = d === 2;
    return { id: `bsp-zh-az-${d + 1}`, mitarbeiter_id: rahmenPerson.id, datum, beginn: lang ? "07:30" : "08:00", ende: lang ? "18:30" : "17:00", pause_minuten: lang ? 30 : 60, notiz: "", ...bsp };
  }).filter((a) => !fei.has(a.datum));

  // --- Fee offers: one accepted version per 79 contract, proj-1 with a replaced V1 -----------------
  const FLACH = ["leistungsbild", "bauherr_contact_id", "bauherr_name", "bauherr_anschrift", "bauherr_ust_idnr", "bauherr_art", "zahlungsziel_tage",
    "zahlungsziel_vertraglich", "anrechenbare_quelle", "kg300_euro", "kg400_euro", "sonstige_euro", "bezugswert", "mvb_euro", "honorarzone",
    "satz_position_prozent", "lph", "umbauzuschlag_prozent", "nebenkosten_prozent", "pauschal_euro", "ust_satz", "textform_am"];
  // An offer always states its payment term (81 data contract): a 79 contract without
  // its own term (zahlungsziel_vertraglich false) gets the value 79's zahlungszielTage
  // would use — the office standard of 14 days (BUERO_STANDARD, E-12). Repeated here
  // because this file loads without the alias hook; zeitHonorarKonsistenz.test.js
  // checks it against 79's chain.
  const flach = (v) => ({ ...Object.fromEntries(FLACH.filter((f) => f in v).map((f) => [f, structuredClone(v[f])])), zahlungsziel_tage: v.zahlungsziel_tage ?? 14 });
  const summen = (a) => {
    const h = honorarVertrag(a);
    return { grund: h.grund, umbau: h.umbau, besondere: 0, nebenkosten: h.nebenkosten, netto: h.netto, ust: h.ust, brutto: h.brutto, quelle: h.quelle };
  };
  /** @type {any[]} */
  const Honorarangebot = [];
  [...vertraege].sort((a, b) => String(a.textform_am).localeCompare(String(b.textform_am))).forEach((v, i) => {
    const datum = /** @type {string} */ (plusTage(v.textform_am || `${Y - 1}-01-15`, -21));
    const nummer = `HA-${datum.slice(0, 4)}-${String(i + 1).padStart(3, "0")}`;
    const gemeinsam = { project_id: v.project_id, nummer, datum, gueltig_bis: plusTage(datum, 30), versendet_am: `${datum}T10:00:00.000Z`,
      dokument_id: null, textbausteine: { vorbemerkung: "", annahmen: "", ausschluesse: "" }, besondere_leistungen: [], ...bsp };
    if (v.id === "bsp-hv-1") {
      const v1 = { ...flach(v), nebenkosten_prozent: 6 };
      Honorarangebot.push({ ...gemeinsam, ...v1, id: "bsp-zh-ha-1a", fassung: 1, ersetzt_id: null, status: "ersetzt", honorarvertrag_id: null, summen: summen(v1) });
      Honorarangebot.push({ ...gemeinsam, ...flach(v), id: "bsp-zh-ha-1", fassung: 2, ersetzt_id: "bsp-zh-ha-1a", status: "angenommen", honorarvertrag_id: v.id,
        datum: plusTage(datum, 7), versendet_am: `${plusTage(datum, 7)}T10:00:00.000Z`, summen: summen(v) });
    } else {
      Honorarangebot.push({ ...gemeinsam, ...flach(v), id: `bsp-zh-ha-${v.id.slice(-1)}`, fassung: 1, ersetzt_id: null, status: "angenommen", honorarvertrag_id: v.id, summen: summen(v) });
    }
  });
  // proj-3: a new, open offer for the interiors (Fixture D: 480.000 €, zone III, LPH 1–8).
  const hv3 = vertrag("bsp-hv-3");
  const innen = {
    leistungsbild: "innenraeume", bauherr_contact_id: null, bauherr_name: hv3?.bauherr_name || "Bauherrschaft B", bauherr_anschrift: hv3?.bauherr_anschrift || "",
    bauherr_ust_idnr: "", bauherr_art: hv3?.bauherr_art || "unternehmer", zahlungsziel_tage: 14, zahlungsziel_vertraglich: true, anrechenbare_quelle: "manuell",
    kg300_euro: 480000, kg400_euro: 0, sonstige_euro: 0, bezugswert: null, mvb_euro: null, honorarzone: "III", satz_position_prozent: 0,
    lph: (leistungsbildInfo("innenraeume")?.lph || []).map((s, i) => ({ beauftragt: i < 8, prozent: s.prozent })),
    umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, pauschal_euro: null, ust_satz: 19, textform_am: null,
  };
  const versendet = /** @type {string} */ (plusTage(heute, -3));
  Honorarangebot.push({
    ...innen, id: "bsp-zh-ha-neu", project_id: "proj-3", nummer: `HA-${Y}-001`, fassung: 1, ersetzt_id: null, status: "versendet",
    datum: versendet, gueltig_bis: plusTage(heute, 11), versendet_am: `${versendet}T10:00:00.000Z`, honorarvertrag_id: null, dokument_id: null,
    textbausteine: { vorbemerkung: "Gemeinschaftshaus, Innenräume", annahmen: "", ausschluesse: "" }, besondere_leistungen: [], summen: summen(innen), ...bsp,
  });

  // --- 81 fields of the proj-1 contract (only fields 79 does not carry) --------------------
  const info1 = leistungsbildInfo(hv1.leistungsbild);
  const honorarvertragPatch = {
    "bsp-hv-1": {
      nummer: `AV-${Y - 1}-002`, angebot_id: "bsp-zh-ha-1", status: "beauftragt", vertragsdatum: `${Y - 1}-03-01`,
      stufen: [{ nr: 1, lph: [1, 2, 3, 4], beauftragt_am: `${Y - 1}-03-01` }, { nr: 2, lph: [5, 6, 7, 8], beauftragt_am: `${Y}-02-01` }],
      termine: [{ titel: "LPH 5 abgeschlossen", datum: plusTage(heute, 63), lph: 5, art: "meilenstein" }],
      haftung: { versicherer: "Beispiel Versicherung AG", deckung_personen_eur: 1500000, deckung_sach_eur: 500000, haftungsbegrenzung_text: "" },
      verguetung_snapshot: {
        summen: { grund: h1.grund, umbau: h1.umbau, besondere: 0, nebenkosten: h1.nebenkosten, netto: h1.netto, ust: h1.ust, brutto: h1.brutto, quelle: h1.quelle },
        tafel_stand: { leistungsbild: hv1.leistungsbild, paragraf: info1?.tafelParagraf ?? null, fassung: info1?.tafel?.fassung ?? null, quelle: info1?.quelle ?? null, abgerufen_am: info1?.abgerufen_am ?? null },
      },
    },
  };

  // --- Fee amendment N1 on the amber stage ----------------------------------------
  const Honorarnachtrag = [{
    id: "bsp-zh-hn-1", honorarvertrag_id: "bsp-hv-1", project_id: "proj-1", nr: 1, titel: "Variantenuntersuchung Fassade", grund: "besondere_leistung",
    lph: gelbI + 1, berechnung: { art: "pauschal", betrag_euro: 8000 }, betrag_euro: 8000, erbracht_prozent: 0, status: "angeboten",
    datum: plusTage(heute, -10), beauftragt_am: null, textform_am: null, ...bsp,
  }];

  // --- Progress history of the running stages: −20 / −10 / 0 pp over three months ------------
  const verlauf = (prog, i) => [-2, -1, 0].map((m, k) => ({
    monat: /** @type {string} */ (plusMonate(heute, m)).slice(0, 7),
    progress: prog.map((f, j) => (j === i ? Math.max(0, f - (2 - k) * 10) : f)),
  }));
  const hoaiPlanVerlauf = { "proj-1": verlauf(p1, gelbI), "proj-2": verlauf(p2, rotI) };

  // --- Cost rates (personnel storage class): valid from January 1st of the year of the ------
  // earliest booking — early in a year the window and the carry-over still lie in the
  // previous year, and the controlling reads the rate valid on each booking day (D-P81-11).
  const ersteBuchung = buchungen.reduce((min, b) => (b.datum < min ? b.datum : min), heute);
  const Kostensatz = personen.map((p) => ({
    id: `bsp-zh-ks-${p.rolle.toLowerCase()}`, mitarbeiter_id: p.id, gueltig_ab: `${ersteBuchung.slice(0, 4)}-01-01`, satz_eur_h: p.satz,
    direkt_eur_h: p.basis ? rund2(p.basis.jahreskosten_eur / p.basis.produktive_stunden_h) : null, herkunft: p.herkunft, basis: p.basis,
    notiz: p.herkunft === "manuell" ? "Inhaber/in ohne Gehalt — Satz von Hand" : "", ...bsp,
  }));

  return {
    Zeitbuchung: buchungen, Arbeitszeit, Honorarangebot, Honorarnachtrag, Kostensatz, honorarvertragPatch, hoaiPlanVerlauf,
    ziele: ziele.map(({ schluessel, project_id, lph, H, F, K }) => ({ schluessel, project_id, lph, H, F, K })),
  };
}
