// Leave balance of a person (phase 82, 82-04, ABW-03): consumption in working
// days, balance per year, carry-over and its lapse.
//
// Law: BUrlG § 7 Abs. 3 (leave of the year, carry-over to 31.03. of the next
// year), § 9 (sick days during leave are not counted, with a medical
// certificate — [ASSUMED] that a recorded sickness has one), BAG 19.02.2019 –
// 9 AZR 423/16 and 9 AZR 541/15 (leave lapses only after the employer pointed
// it out in time). This module never computes the entitlement itself: it
// comes from phase 80 (aktiverVertrag + urlaubsanspruch, D-P82-12, one way of
// computing). The notice is 80's deadline "resturlaub_hinweis" with its
// Fristquittung — there is no second notice entity or deadline here (D-P82-11).
//
// Working days: Phase 80 stores only the NUMBER of working days per week; the
// days themselves follow the rule kalender.arbeitstage_muster ("the first n
// weekdays from Monday", [ASSUMED], finding for 80). Christmas Eve and New
// Year's Eve follow kalender.heiligabend_silvester (working day / half / off).
// Long-term illness (15-month lapse) and parental leave reductions are only
// warnings "manuell prüfen" — a liability decision, not a computation.
//
// In:  absences, contracts, persons, acknowledgements, holidays per year. Out:
//      arbeitstageMuster, verbrauch, hinweisQuittiert, urlaubskonto.

import { aktiverVertrag } from "@/lib/people/vertrag.js";
import { urlaubsanspruch } from "@/lib/people/urlaub.js";
import { PERSONENARTEN } from "@/lib/people/mitarbeiter.js";

/** @param {string} tag @param {number} n @returns {string} */
function plus(tag, n) {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** @param {string} tag @returns {number} 0 = Sunday … 6 = Saturday */
const wochentagVon = (tag) => new Date(`${tag}T12:00:00Z`).getUTCDay();

/**
 * Working weekdays of a person: the first n weekdays from Monday ([ASSUMED] rule "erste_n").
 * @param {number|null|undefined} arbeitstageWoche
 * @returns {Set<number>} weekday numbers 1 = Monday … 6 = Saturday
 */
export function arbeitstageMuster(arbeitstageWoche) {
  const n = Math.min(6, Math.max(1, Math.round(Number(arbeitstageWoche) || 5)));
  return new Set(Array.from({ length: n }, (_, i) => i + 1));
}

/**
 * Weight of one day of leave: 0 off, 0.5 half, 1 full.
 * @param {string} tag 'YYYY-MM-DD'
 * @param {{muster: Set<number>, feiertage: ReadonlyArray<{datum: string}>, heiligabendSilvester?: string}} k
 * @returns {number}
 */
function gewicht(tag, { muster, feiertage, heiligabendSilvester = "arbeitstag" }) {
  if (!muster.has(wochentagVon(tag))) return 0;
  if (feiertage.some((f) => f.datum === tag)) return 0;
  if (tag.endsWith("-12-24") || tag.endsWith("-12-31")) {
    if (heiligabendSilvester === "frei") return 0;
    if (heiligabendSilvester === "halb") return 0.5;
  }
  return 1;
}

/**
 * Days of an absence counted as leave, per calendar year (working days of the
 * person without holidays; half days at start/end; sick days inside are not counted, § 9).
 * @param {Record<string, any>} abwesenheit {von, bis, halbtag_von, halbtag_bis}
 * @param {{arbeitstageWoche?: number|null, feiertageFuer: (jahr: number) => ReadonlyArray<{datum: string}>,
 *   heiligabendSilvester?: string, krankTage?: ReadonlySet<string>}} kontext
 * @returns {Record<number, number>} days per year
 */
export function verbrauch(abwesenheit, { arbeitstageWoche = 5, feiertageFuer, heiligabendSilvester = "arbeitstag", krankTage = new Set() }) {
  /** @type {Record<number, number>} */
  const proJahr = {};
  const von = String(abwesenheit?.von || "");
  const bis = String(abwesenheit?.bis || von);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(von) || bis < von) return proJahr;
  const muster = arbeitstageMuster(arbeitstageWoche);
  /** @type {Record<number, ReadonlyArray<{datum: string}>>} */
  const ft = {};
  for (let tag = von; tag <= bis; tag = plus(tag, 1)) {
    const jahr = Number(tag.slice(0, 4));
    ft[jahr] ||= feiertageFuer(jahr) || [];
    if (krankTage.has(tag)) continue;
    let g = gewicht(tag, { muster, feiertage: ft[jahr], heiligabendSilvester });
    if (g > 0 && ((tag === von && abwesenheit.halbtag_von) || (tag === bis && abwesenheit.halbtag_bis))) g = Math.min(g, 0.5);
    if (g > 0) proJahr[jahr] = (proJahr[jahr] || 0) + g;
  }
  return proJahr;
}

/**
 * Whether 80's notice on open leave of a year was acknowledged
 * (Fristquittung "resturlaub_hinweis:<bezug>:<faellig_am>" with a due date in that year).
 * @param {ReadonlyArray<Record<string, any>>} fristquittungen
 * @param {number} jahr
 * @returns {boolean}
 */
export function hinweisQuittiert(fristquittungen, jahr) {
  return (fristquittungen || []).some((q) => {
    const teile = String(q?.schluessel || "").split(":");
    return teile[0] === "resturlaub_hinweis" && String(teile[teile.length - 1]).startsWith(`${jahr}-`) && Boolean(q?.quittiert_am);
  });
}

/** Days of the approved sicknesses of a person (for § 9). @param {ReadonlyArray<any>} abwesenheiten @param {string} id @returns {Set<string>} */
function krankTageVon(abwesenheiten, id) {
  const tage = new Set();
  for (const a of abwesenheiten) {
    if (a?.mitarbeiter_id !== id || a.art !== "krank" || a.status !== "genehmigt" || !a.von) continue;
    for (let t = a.von; t <= (a.bis || a.von); t = plus(t, 1)) tage.add(t);
  }
  return tage;
}

/**
 * Leave balance of a person in a year.
 * @param {{
 *   mitarbeiter: Record<string, any>, vertraege: ReadonlyArray<any>, abwesenheiten: ReadonlyArray<any>,
 *   fristquittungen?: ReadonlyArray<any>, jahr: number, heute: string,
 *   feiertageFuer: (jahr: number) => ReadonlyArray<{datum: string}>, regelWert?: (id: string) => any,
 * }} e
 * @returns {{
 *   ohneArbeitsrecht: boolean, anspruch: number|null, berechnung: string|null, uebertrag: number,
 *   genommen: number, geplant: number, beantragt: number, rest: number|null,
 *   verfall: {status: 'verfaellt'|'uebertragen_hinweis_fehlt'|'kein_rest', verfallAm: string|null},
 *   warnungen: Array<{art: string}>,
 * }} days
 */
export function urlaubskonto({ mitarbeiter, vertraege, abwesenheiten, fristquittungen = [], jahr, heute, feiertageFuer, regelWert = () => undefined }) {
  const leer = { uebertrag: 0, genommen: 0, geplant: 0, beantragt: 0, rest: null, verfall: { status: /** @type {const} */ ("kein_rest"), verfallAm: null }, warnungen: [] };
  const art = PERSONENARTEN.find((p) => p.key === mitarbeiter?.art);
  if (!mitarbeiter || (art && !art.arbeitsrecht)) return { ohneArbeitsrecht: true, anspruch: null, berechnung: null, ...leer };
  const stichtag = heute.startsWith(`${jahr}-`) ? heute : heute < `${jahr}-01-01` ? `${jahr}-01-01` : `${jahr}-12-31`;
  const vertrag = aktiverVertrag(/** @type {any} */ (vertraege), mitarbeiter.id, stichtag);
  if (!vertrag) return { ohneArbeitsrecht: false, anspruch: null, berechnung: null, ...leer };
  const hs = regelWert("kalender.heiligabend_silvester") || "arbeitstag";
  const eigene = (abwesenheiten || []).filter((a) => a?.mitarbeiter_id === mitarbeiter.id);
  const krankTage = krankTageVon(eigene, mitarbeiter.id);
  const k = { arbeitstageWoche: vertrag.arbeitstage_woche, feiertageFuer, heiligabendSilvester: hs, krankTage };

  /** Approved leave days of a year split at `heute` (taken ≤ heute < planned). */
  const summen = (/** @type {number} */ j) => {
    let genommen = 0;
    let geplant = 0;
    let beantragt = 0;
    for (const a of eigene) {
      if (a.art !== "urlaub" || !["genehmigt", "beantragt"].includes(a.status)) continue;
      if (a.status === "beantragt") { beantragt += verbrauch(a, k)[j] || 0; continue; }
      const vorHeute = verbrauch({ ...a, bis: a.bis < heute ? a.bis : heute, halbtag_bis: a.bis <= heute && a.halbtag_bis }, k)[j] || 0;
      const nachHeute = a.bis > heute ? verbrauch({ ...a, von: a.von > heute ? a.von : plus(heute, 1), halbtag_von: a.von > heute && a.halbtag_von }, k)[j] || 0 : 0;
      genommen += a.von <= heute ? vorHeute : 0;
      geplant += nachHeute;
    }
    return { genommen, geplant, beantragt };
  };
  const anspruchVon = (/** @type {number} */ j) => urlaubsanspruch({ urlaub_tage_jahr: vertrag.urlaub_tage_jahr, eintritt: mitarbeiter.eintritt || vertrag.beginn, austritt: mitarbeiter.austritt || vertrag.ende || null, jahr: j });

  const a = anspruchVon(jahr);
  // Carry-over: the rest of the previous year, unless it lapsed (notice acknowledged, 31.03. passed).
  const vor = summen(jahr - 1);
  const vorAnspruch = vertrag.beginn <= `${jahr - 1}-12-31` ? anspruchVon(jahr - 1).tage : 0;
  const restVorjahr = Math.max(0, vorAnspruch - vor.genommen - vor.geplant);
  const uebertragBis = String(regelWert("personal.uebertrag_bis") || "03-31");
  const verfallenVorjahr = hinweisQuittiert(fristquittungen, jahr - 1) && heute > `${jahr}-${uebertragBis}`;
  const uebertrag = verfallenVorjahr ? 0 : restVorjahr;
  const s = summen(jahr);
  const rest = Math.round((a.tage + uebertrag - s.genommen - s.geplant) * 10) / 10;
  /** @type {{status: 'verfaellt'|'uebertragen_hinweis_fehlt'|'kein_rest', verfallAm: string|null}} */
  const verfall = rest <= 0 ? { status: "kein_rest", verfallAm: null }
    : hinweisQuittiert(fristquittungen, jahr) ? { status: "verfaellt", verfallAm: `${jahr + 1}-${uebertragBis}` }
      : { status: "uebertragen_hinweis_fehlt", verfallAm: null };
  /** @type {Array<{art: string}>} */
  const warnungen = [];
  if (eigene.some((x) => x.art === "elternzeit" && x.status === "genehmigt" && String(x.von).slice(0, 4) <= String(jahr) && String(x.bis).slice(0, 4) >= String(jahr))) warnungen.push({ art: "elternzeit_manuell_pruefen" });
  if (krankTage.size > 42) warnungen.push({ art: "langzeit_krank_manuell_pruefen" });
  return { ohneArbeitsrecht: false, anspruch: a.tage, berechnung: a.berechnung, uebertrag, genommen: s.genommen, geplant: s.geplant, beantragt: s.beantragt, rest, verfall, warnungen };
}
