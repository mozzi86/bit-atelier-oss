// Project controlling (phase 81, CTRL-01…04): fee against effort per project and
// work stage (LPH), contribution margin, remaining budget, forecast, the early
// warning light, the portfolio over all projects and the month series. Pure — no
// API, no React; the page passes the records it loaded through the storage layer
// (src/lib/zeitHonorar/speicher.js) and the personnel adapter
// (src/lib/people/zeitHonorarPersonal.js), and the rule values of zeit_honorar.*.
//
// Formulas (81-RESEARCH § Formeln), per commissioned LPH i:
//   h    = honorarVertrag(vertrag)            79's single fee engine — 81 computes no fee of its own
//   H_i  = round(h.lph[i].betrag × (1 + h.umbau / h.grund)) + Σ commissioned fee amendments (lph = i)
//          (no incidental costs; the factor uses the conversion surcharge 79 already capped
//          at umbau_max_prozent, never the raw umbauzuschlag_prozent)
//          lump sum (h.lph = []): H_i = round(h.grund × prozent_i / Σ prozent of the commissioned
//          LPH) [ASSUMED], the rounding remainder goes to the last LPH; label
//          "Pauschale anteilig nach LPH-Prozent"
//   F_i  = HoaiPlan.progress[i] / 100 — only for profiles with the nine LPH of the
//          Objektplanung (as 79's lpStand); otherwise null
//   K_i  = Σ over groups (person × valid rate) round(Σ minutes × rate_ct / 60) — rounded per
//          group, never per booking (D-P81-13: 1.000 quarter-hour bookings must not drift)
//   V = K/H · E = H × F · DB = E − K · EAC = K/F · PDB = H − EAC · R = H − K · rest hours = R / office rate
// Traffic light (AMPEL_REGELN): grey without contract, fee ("Tafel fehlt", outside
// the table) or progress; "ohne Zeiten" at K = 0 with F > 0; red when V − F >
// zeit_honorar.ampel_rot or K > H; yellow when V − F > zeit_honorar.ampel_gelb;
// green otherwise. Missing data is grey, never red: a red light triggers action,
// and acting on a light that only reflects missing input is a liability, not a
// warning (Haftungsentscheidung, E-13).
//
// Bookings: 'abgelehnt' never counts; with nurFreigegeben only 'freigegeben'
// (D-P81-12). Hours without a valid rate are reported as minutes "ohne
// Kostensatz" and never valued at 0 € (T-81-26).
//
// In:  contract (79 Honorarvertrag), fee amendments, HoaiPlan, bookings, cost rates
//      (personnel class — only with access), persons, rule values.
// Out: projektControlling, ampel, gewichteterFortschritt, portfolio, monatsreihe,
//      buerosatz, hauptvertrag, AMPEL_REGELN.

import { honorarVertrag, lphFuerLeistungsbild } from "@core/lib/hoai/honorar.js";
import { leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";
import { istArchiviert } from "@core/lib/projektArchiv.js";
import { buerosatz as buerosatzAusSaetzen, gueltigerSatz } from "./kostensatz.js";
import { INHABER_ID, personIdFuer } from "@/lib/zeit/personalQuelle.js";

/**
 * The traffic-light states in order of severity (worst first), with the chip
 * text (German i18n key) and the colour token of the UI.
 * @type {Readonly<Record<string, Readonly<{rang: number, label: string, farbe: string}>>>}
 */
export const AMPEL_REGELN = Object.freeze({
  rot: Object.freeze({ rang: 4, label: "kritisch", farbe: "rot" }),
  gelb: Object.freeze({ rang: 3, label: "Achtung", farbe: "gelb" }),
  gruen: Object.freeze({ rang: 2, label: "im Plan", farbe: "gruen" }),
  ohne_zeiten: Object.freeze({ rang: 1, label: "ohne Zeiten", farbe: "grau" }),
  grau: Object.freeze({ rang: 0, label: "ohne Daten", farbe: "grau" }),
});

/** @param {number} x Euro @returns {number} cents */
const cent = (x) => Math.round(((Number(x) || 0) + Number.EPSILON) * 100);
/** @param {number} c cents @returns {number} Euro */
const euro = (c) => c / 100;
/** @param {number} x @returns {number} two decimals */
const rund2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

/**
 * Traffic light of one LPH (or a project row).
 * @param {{H: number|null, K: number, F: number|null, minuten?: number, minutenOhneSatz?: number}} werte
 *   Euro, Euro, percent (0–100); minutes counted and minutes without a cost rate (optional)
 * @param {{gelbPp: number, rotPp: number}} schwellen zeit_honorar.ampel_gelb / _rot in percentage points
 * @returns {'grau'|'ohne_zeiten'|'rot'|'gelb'|'gruen'}
 */
export function ampel({ H, K, F, minuten = 0, minutenOhneSatz = 0 }, { gelbPp, rotPp }) {
  if (H === null || H === undefined || F === null || F === undefined) return "grau";
  // Hours booked but none of them valued (no cost rate): the light would read
  // "green at 0 €" — that is missing input, so grey (T-81-26).
  if (minuten > 0 && minutenOhneSatz >= minuten) return "grau";
  if (!(K > 0) && F > 0) return "ohne_zeiten";
  if (K > H) return "rot";
  const V = H > 0 ? (K / H) * 100 : 0;
  const abstand = V - F;
  if (abstand > (Number(rotPp) || 0)) return "rot";
  if (abstand > (Number(gelbPp) || 0)) return "gelb";
  return "gruen";
}

/**
 * The worst light of several (rot > gelb > grün > ohne Zeiten > grau).
 * @param {ReadonlyArray<string>} ampeln
 * @returns {'grau'|'ohne_zeiten'|'rot'|'gelb'|'gruen'}
 */
function schlechteste(ampeln) {
  let best = "grau";
  for (const a of ampeln) if ((AMPEL_REGELN[a]?.rang ?? 0) > (AMPEL_REGELN[best]?.rang ?? 0)) best = a;
  return /** @type {any} */ (best);
}

/**
 * Progress weighted by fee: Σ H·F / Σ H over the rows with a fee and a progress.
 * @param {ReadonlyArray<{H: number|null, F: number|null}>} zeilen H in Euro, F in percent
 * @returns {number|null} percent, one decimal
 */
export function gewichteterFortschritt(zeilen) {
  let summeH = 0;
  let summeHF = 0;
  for (const z of zeilen || []) {
    if (typeof z.H !== "number" || !(z.H > 0) || typeof z.F !== "number") continue;
    summeH += z.H;
    summeHF += z.H * z.F;
  }
  return summeH > 0 ? Math.round((summeHF / summeH) * 10) / 10 : null;
}

/**
 * Office rate in Euro/hour (D-P81-22): the rule zeit_honorar.buerosatz when set,
 * otherwise the plain mean of the rates valid on the day of the ACTIVE persons
 * (incl. the virtual owner). Deliberately not weighted by hours — a weighted mean
 * could be solved back to a single person's rate.
 * @param {ReadonlyArray<Record<string, any>>} kostensaetze personnel class (empty without access)
 * @param {ReadonlyArray<Record<string, any>>} mitarbeiter 80 records (empty without access)
 * @param {string} datumIso 'YYYY-MM-DD'
 * @param {number|null|undefined} regelWert zeit_honorar.buerosatz (Euro/hour) or null
 * @returns {{satz: number, quelle: 'regel'|'mittel'}|null}
 */
export function buerosatz(kostensaetze, mitarbeiter, datumIso, regelWert) {
  const ausgeschieden = new Set((mitarbeiter || []).filter((m) => m && (m.status === "ausgeschieden" || (m.austritt && m.austritt < datumIso))).map((m) => m.id));
  const saetze = (kostensaetze || []).filter((s) => s && !ausgeschieden.has(s.mitarbeiter_id));
  return buerosatzAusSaetzen(saetze, datumIso, regelWert);
}

/**
 * The contract the controlling of a project runs on when a project has several
 * (79: "≥ 1 per project"; bookings carry no contract id): the commissioned ones
 * (or 79 contracts without a phase-81 status) first, then the latest contract date
 * [ASSUMED — one stage list per project; the other contracts are named in the UI].
 * @param {ReadonlyArray<Record<string, any>>} vertraege contracts of ONE project
 * @returns {Record<string, any>|null}
 */
export function hauptvertrag(vertraege) {
  const liste = (vertraege || []).filter(Boolean);
  if (!liste.length) return null;
  const aktiv = (/** @type {any} */ v) => (!v.status || v.status === "beauftragt" || v.status === "ruht" ? 1 : 0);
  const datum = (/** @type {any} */ v) => String(v.vertragsdatum || v.created_date || "");
  return [...liste].sort((a, b) => aktiv(b) - aktiv(a) || datum(b).localeCompare(datum(a)))[0];
}

/**
 * Bookings that count: never 'abgelehnt'; with nurFreigegeben only 'freigegeben';
 * with a cut-off day only up to that day.
 * @param {ReadonlyArray<Record<string, any>>} buchungen
 * @param {{nurFreigegeben?: boolean, stichtagIso?: string}} optionen
 * @returns {Array<Record<string, any>>}
 */
function zaehlendeBuchungen(buchungen, { nurFreigegeben = false, stichtagIso } = {}) {
  return (buchungen || []).filter((b) => b && b.status !== "abgelehnt" && (!nurFreigegeben || b.status === "freigegeben")
    && (!stichtagIso || !b.datum || b.datum <= stichtagIso) && (Number(b.minuten) || 0) > 0);
}

/**
 * Rate lookup of one booking.
 * @typedef {{satzModus: 'persoenlich'|'buero', kostensaetze: ReadonlyArray<Record<string, any>>, mitarbeiter: ReadonlyArray<Record<string, any>>, buero: {satz: number, quelle: string}|null}} SatzKontext
 */

/**
 * Person and rate of a booking: in personal mode the rate valid on the booking's
 * day (the owner's manual rate also under the virtual id, E-17); in office mode
 * the office rate for everybody. Null rate = "ohne Kostensatz".
 * @param {Record<string, any>} b booking
 * @param {SatzKontext} k
 * @returns {{personId: string, satz: number|null}}
 */
function satzFuer(b, k) {
  const personId = personIdFuer(String(b.mitarbeiter_id || ""), k.mitarbeiter);
  if (k.satzModus === "buero") return { personId, satz: k.buero ? k.buero.satz : null };
  const kandidaten = [personId, String(b.mitarbeiter_id || "")];
  if (personId !== INHABER_ID && k.mitarbeiter.some((m) => m?.id === personId && m.art === "inhaber")) kandidaten.push(INHABER_ID);
  for (const id of kandidaten) {
    const s = gueltigerSatz(k.kostensaetze, id, String(b.datum || ""));
    if (s) return { personId, satz: s.satz_eur_h };
  }
  return { personId, satz: null };
}

/**
 * Cost of bookings, rounded per group person × rate (D-P81-13).
 * @param {ReadonlyArray<Record<string, any>>} buchungen
 * @param {SatzKontext} k
 * @returns {{minuten: number, minutenOhneSatz: number, cent: number, jePerson: Record<string, number>}}
 */
function kosten(buchungen, k) {
  /** @type {Map<string, {minuten: number, satz: number}>} */
  const gruppen = new Map();
  /** @type {Record<string, number>} */
  const jePerson = {};
  let minuten = 0;
  let ohne = 0;
  for (const b of buchungen) {
    const m = Number(b.minuten) || 0;
    const { personId, satz } = satzFuer(b, k);
    minuten += m;
    jePerson[personId] = (jePerson[personId] || 0) + m;
    if (typeof satz !== "number") { ohne += m; continue; }
    const schluessel = `${personId}|${satz}`;
    const g = gruppen.get(schluessel) || { minuten: 0, satz };
    g.minuten += m;
    gruppen.set(schluessel, g);
  }
  let summe = 0;
  for (const g of gruppen.values()) summe += Math.round((g.minuten * cent(g.satz)) / 60);
  return { minuten, minutenOhneSatz: ohne, cent: summe, jePerson };
}

/**
 * Fee per LPH in cents: 79's stage amounts with the capped conversion factor, or
 * the lump sum spread by the LPH percentages of the commissioned stages.
 * @param {Record<string, any>} vertrag
 * @param {ReturnType<typeof honorarVertrag>} h
 * @returns {{stufen: Array<{nr: number, beauftragt: boolean, cent: number|null}>, pauschalAnteilig: boolean}}
 */
function honorarJeLph(vertrag, h) {
  if (h.quelle === "pauschal") {
    const eingabe = Array.isArray(vertrag.lph) && vertrag.lph.length ? vertrag.lph : lphFuerLeistungsbild(vertrag.leistungsbild);
    const info = leistungsbildInfo(vertrag.leistungsbild);
    const stufen = eingabe.map((/** @type {any} */ l, /** @type {number} */ i) => ({ nr: info?.lph?.[i]?.nr ?? i + 1, beauftragt: l?.beauftragt === true, prozent: Number(l?.prozent) || 0 }));
    const beauftragt = stufen.filter((s) => s.beauftragt);
    const summeProzent = beauftragt.reduce((a, s) => a + s.prozent, 0);
    const grund = cent(/** @type {number} */ (h.grund));
    let verteilt = 0;
    const letzte = beauftragt[beauftragt.length - 1];
    return {
      pauschalAnteilig: true,
      stufen: stufen.map((s) => {
        if (!s.beauftragt || !(summeProzent > 0)) return { nr: s.nr, beauftragt: s.beauftragt, cent: s.beauftragt ? null : 0 };
        const c = s === letzte ? grund - verteilt : Math.round((grund * s.prozent) / summeProzent);
        verteilt += c;
        return { nr: s.nr, beauftragt: true, cent: c };
      }),
    };
  }
  if (h.quelle !== "tafel") {
    // "Tafel fehlt" or outside the table: stages are known, amounts are not.
    const eingabe = Array.isArray(vertrag.lph) && vertrag.lph.length ? vertrag.lph : lphFuerLeistungsbild(vertrag.leistungsbild);
    const info = leistungsbildInfo(vertrag.leistungsbild);
    return { pauschalAnteilig: false, stufen: eingabe.map((/** @type {any} */ l, /** @type {number} */ i) => ({ nr: info?.lph?.[i]?.nr ?? i + 1, beauftragt: l?.beauftragt === true, cent: null })) };
  }
  const faktor = h.grund ? 1 + (Number(h.umbau) || 0) / h.grund : 1;
  return {
    pauschalAnteilig: false,
    stufen: h.lph.map((l) => ({ nr: l.nr, beauftragt: l.beauftragt, cent: l.beauftragt ? Math.round(cent(l.betrag) * faktor) : 0 })),
  };
}

/**
 * Progress per LPH in percent from HoaiPlan.progress — only for the nine stages
 * of the Objektplanung (79's lpStand rule); null otherwise.
 * @param {Record<string, any>|null|undefined} vertrag
 * @param {{progress?: Array<number|null>}|null|undefined} plan
 * @returns {{stand: Record<number, number|null>|null, grund: 'kein_plan'|'nur_objektplanung'|null}}
 */
function leistungsstand(vertrag, plan) {
  const info = leistungsbildInfo(vertrag?.leistungsbild || "gebaeude");
  if (!info || info.lph.length !== 9) return { stand: null, grund: "nur_objektplanung" };
  if (!plan || !Array.isArray(plan.progress)) return { stand: null, grund: "kein_plan" };
  /** @type {Record<number, number|null>} */
  const stand = {};
  info.lph.forEach((s, i) => { stand[s.nr] = typeof plan.progress?.[i] === "number" ? /** @type {number} */ (plan.progress[i]) : null; });
  return { stand, grund: null };
}

/**
 * @typedef {{
 *   lph: number, beauftragt: boolean, H: number|null, K: number, F: number|null, V: number|null, E: number|null,
 *   DB: number|null, EAC: number|null, PDB: number|null, R: number|null, reststunden: number|null,
 *   ampel: string, minuten: number, minutenOhneSatz: number, nachtragH: number,
 * }} LphZeile
 */

/**
 * Controlling of one project.
 * @param {{
 *   vertrag: Record<string, any>|null, nachtraege?: ReadonlyArray<Record<string, any>>, hoaiPlan?: Record<string, any>|null,
 *   projekt?: Record<string, any>|null, buchungen?: ReadonlyArray<Record<string, any>>, kostensaetze?: ReadonlyArray<Record<string, any>>,
 *   mitarbeiter?: ReadonlyArray<Record<string, any>>, regeln?: {ampel_gelb?: number, ampel_rot?: number, buerosatz?: number|null},
 * }} daten bookings of THIS project; rule values of zeit_honorar.*
 * @param {{satzModus?: 'persoenlich'|'buero', nurFreigegeben?: boolean, stichtagIso?: string, optionen?: {weitere?: ReadonlyArray<any>}}} [einstellung]
 *   satzModus 'buero' also when the user has no personnel access; optionen only for test injection
 * @returns {{
 *   lph: LphZeile[], ohneLph: {minuten: number, K: number, minutenOhneSatz: number, H: number},
 *   summe: {H: number|null, K: number, E: number|null, DB: number|null, R: number|null},
 *   fortschrittGewichtet: number|null, ampel: string, tafelFehlt: boolean, honorarQuelle: string|null,
 *   pauschalAnteilig: boolean, ohneLeistungsstand: 'kein_plan'|'nur_objektplanung'|null, ohneVertrag: boolean,
 *   ohneKostensatzMinuten: number, stundenJeMitarbeiter: Record<string, number>,
 *   satzQuelle: 'persoenlich'|'regel'|'mittel'|null, buerosatz: number|null,
 * }} Euro values with two decimals; V and F in percent; stundenJeMitarbeiter in MINUTES (never money)
 */
export function projektControlling(daten, einstellung = {}) {
  const { vertrag = null, nachtraege = [], hoaiPlan = null, buchungen = [], kostensaetze = [], mitarbeiter = [], regeln = {} } = daten || {};
  const { satzModus = "persoenlich", nurFreigegeben = false, stichtagIso, optionen = {} } = einstellung;
  const stichtag = stichtagIso || new Date().toISOString().slice(0, 10);
  const schwellen = { gelbPp: Number(regeln.ampel_gelb) || 0, rotPp: typeof regeln.ampel_rot === "number" ? regeln.ampel_rot : 10 };
  const buero = buerosatz(kostensaetze, mitarbeiter, stichtag, regeln.buerosatz ?? null);
  /** @type {SatzKontext} */
  const k = { satzModus, kostensaetze, mitarbeiter, buero };
  const zaehlend = zaehlendeBuchungen(buchungen, { nurFreigegeben, stichtagIso });

  const h = vertrag ? honorarVertrag(vertrag, optionen) : null;
  const { stufen, pauschalAnteilig } = vertrag && h ? honorarJeLph(vertrag, h) : { stufen: [], pauschalAnteilig: false };
  const ohneHonorar = !h || (h.quelle !== "tafel" && h.quelle !== "pauschal");
  const { stand, grund: ohneLeistungsstand } = vertrag ? leistungsstand(vertrag, hoaiPlan) : { stand: null, grund: null };

  // Commissioned fee amendments add to the fee of their LPH (no incidental costs).
  /** @type {Record<string, number>} */
  const nachtragCent = {};
  let nachtragOhneLph = 0;
  for (const n of nachtraege || []) {
    if (!vertrag || n?.honorarvertrag_id !== vertrag.id || n.status !== "beauftragt") continue;
    if (typeof n.lph === "number") nachtragCent[n.lph] = (nachtragCent[n.lph] || 0) + cent(n.betrag_euro);
    else nachtragOhneLph += cent(n.betrag_euro);
  }

  const jeLph = new Map();
  for (const b of zaehlend) {
    const schluessel = typeof b.lph === "number" ? b.lph : null;
    jeLph.set(schluessel, [...(jeLph.get(schluessel) || []), b]);
  }
  const nummern = new Set([...stufen.filter((s) => s.beauftragt).map((s) => s.nr), ...[...jeLph.keys()].filter((x) => x !== null), ...Object.keys(nachtragCent).map(Number)]);
  const reihenfolge = [...nummern].sort((a, b) => a - b);
  const satzBuero = buero ? buero.satz : null;

  /** @type {LphZeile[]} */
  const zeilen = reihenfolge.map((nr) => {
    const stufe = stufen.find((s) => s.nr === nr);
    const kz = kosten(jeLph.get(nr) || [], k);
    const nH = nachtragCent[nr] || 0;
    const Hc = ohneHonorar ? null : (stufe?.cent ?? 0) + nH;
    const F = stand ? (stand[nr] ?? null) : null;
    const H = Hc === null ? null : euro(Hc);
    const K = euro(kz.cent);
    const V = H !== null && H > 0 ? rund2((K / H) * 100) : null;
    const Ec = Hc !== null && F !== null ? Math.round((Hc * F) / 100) : null;
    const EACc = F !== null && F > 0 ? Math.round((kz.cent * 100) / F) : null;
    const Rc = Hc !== null ? Hc - kz.cent : null;
    return {
      lph: nr,
      beauftragt: stufe?.beauftragt === true || nH > 0,
      H, K, F, V,
      E: Ec === null ? null : euro(Ec),
      DB: Ec === null ? null : euro(Ec - kz.cent),
      EAC: EACc === null ? null : euro(EACc),
      PDB: EACc === null || Hc === null ? null : euro(Hc - EACc),
      R: Rc === null ? null : euro(Rc),
      reststunden: Rc === null || !satzBuero ? null : Math.round((Rc / cent(satzBuero)) * 10) / 10,
      ampel: ampel({ H, K, F, minuten: kz.minuten, minutenOhneSatz: kz.minutenOhneSatz }, schwellen),
      minuten: kz.minuten,
      minutenOhneSatz: kz.minutenOhneSatz,
      nachtragH: euro(nH),
    };
  });

  const ohne = kosten(jeLph.get(null) || [], k);
  const gesamt = kosten(zaehlend, k);
  const summeHc = ohneHonorar ? null : zeilen.reduce((a, z) => a + cent(z.H ?? 0), 0) + nachtragOhneLph;
  const mitStand = zeilen.filter((z) => z.E !== null);
  const summeEc = mitStand.length ? mitStand.reduce((a, z) => a + cent(/** @type {number} */ (z.E)), 0) : null;
  const summeKc = zeilen.reduce((a, z) => a + cent(z.K), 0) + ohne.cent;
  const relevant = zeilen.filter((z) => z.beauftragt || z.minuten > 0);
  // A warning (red/amber) always shows. Otherwise a worked stage that could not be
  // valued (hours, but no cost rate or no progress) makes the project grey — the green
  // of stages not yet started must not cover missing input (T-81-26).
  const warnend = relevant.filter((z) => z.ampel === "rot" || z.ampel === "gelb");
  const projektAmpel = !vertrag || ohneHonorar ? "grau"
    : warnend.length ? schlechteste(warnend.map((z) => z.ampel))
      : relevant.some((z) => z.ampel === "grau" && z.minuten > 0) ? "grau" : schlechteste(relevant.map((z) => z.ampel));

  return {
    lph: zeilen,
    ohneLph: { minuten: ohne.minuten, K: euro(ohne.cent), minutenOhneSatz: ohne.minutenOhneSatz, H: euro(nachtragOhneLph) },
    summe: {
      H: summeHc === null ? null : euro(summeHc),
      K: euro(summeKc),
      E: summeEc === null ? null : euro(summeEc),
      DB: summeEc === null ? null : euro(summeEc - summeKc),
      R: summeHc === null ? null : euro(summeHc - summeKc),
    },
    fortschrittGewichtet: gewichteterFortschritt(zeilen),
    ampel: projektAmpel,
    tafelFehlt: h?.quelle === "tafel_fehlt",
    honorarQuelle: h ? h.quelle : null,
    pauschalAnteilig,
    ohneLeistungsstand,
    ohneVertrag: !vertrag,
    ohneKostensatzMinuten: gesamt.minutenOhneSatz,
    stundenJeMitarbeiter: gesamt.jePerson,
    satzQuelle: satzModus === "buero" ? (buero ? /** @type {'regel'|'mittel'} */ (buero.quelle) : null) : "persoenlich",
    buerosatz: satzBuero,
  };
}

/**
 * Portfolio: one row per project with a contract or with bookings.
 * @param {ReadonlyArray<Record<string, any>>} projekte all projects (incl. archived, flagged)
 * @param {{
 *   vertraege?: ReadonlyArray<Record<string, any>>, nachtraege?: ReadonlyArray<Record<string, any>>, hoaiPlaene?: ReadonlyArray<Record<string, any>>,
 *   buchungen?: ReadonlyArray<Record<string, any>>, kostensaetze?: ReadonlyArray<Record<string, any>>, mitarbeiter?: ReadonlyArray<Record<string, any>>,
 *   angebote?: ReadonlyArray<Record<string, any>>, regeln?: Record<string, any>,
 * }} daten
 * @param {Parameters<typeof projektControlling>[1]} [einstellung]
 * @returns {Array<{project_id: string, name: string, archiviert: boolean, vertrag: Record<string, any>|null, weitereVertraege: number, angebotOffen: Record<string, any>|null, c: ReturnType<typeof projektControlling>}>}
 */
export function portfolio(projekte, daten, einstellung = {}) {
  const { vertraege = [], nachtraege = [], hoaiPlaene = [], buchungen = [], kostensaetze = [], mitarbeiter = [], angebote = [], regeln = {} } = daten || {};
  const ids = new Set([...vertraege.map((v) => v?.project_id), ...buchungen.filter((b) => b?.status !== "abgelehnt").map((b) => b?.project_id)].filter(Boolean));
  const namen = new Map((projekte || []).map((p) => [p.id, p]));
  return [...ids].map((id) => {
    const p = namen.get(id) || null;
    const eigene = vertraege.filter((v) => v.project_id === id);
    const vertrag = hauptvertrag(eigene);
    const offen = angebote.filter((a) => a.project_id === id && (a.status === "versendet" || a.status === "entwurf"))
      .sort((a, b) => String(b.datum || "").localeCompare(String(a.datum || "")))[0] || null;
    return {
      project_id: id,
      name: p?.name || id,
      archiviert: istArchiviert(p),
      vertrag,
      weitereVertraege: Math.max(0, eigene.length - 1),
      angebotOffen: vertrag ? null : offen,
      c: projektControlling({
        vertrag, nachtraege, hoaiPlan: hoaiPlaene.find((h) => h.project_id === id) || null, projekt: p,
        buchungen: buchungen.filter((b) => b.project_id === id), kostensaetze, mitarbeiter, regeln,
      }, einstellung),
    };
  }).sort((a, b) => (AMPEL_REGELN[b.c.ampel]?.rang ?? 0) - (AMPEL_REGELN[a.c.ampel]?.rang ?? 0) || a.name.localeCompare(b.name, "de"));
}

/**
 * Month series of a project: minutes, cost, earned value from HoaiPlan.verlauf
 * (previous month → month; the first month of the history has no ΔE because the
 * progress before it is unknown), invoiced (issued, non-storno invoices of the
 * contract by invoice date, net — 79's convention) and DB = ΔE − K.
 * @param {{
 *   hoaiPlan?: Record<string, any>|null, vertrag: Record<string, any>|null, nachtraege?: ReadonlyArray<Record<string, any>>,
 *   buchungen?: ReadonlyArray<Record<string, any>>, kostensaetze?: ReadonlyArray<Record<string, any>>,
 *   mitarbeiter?: ReadonlyArray<Record<string, any>>, rechnungen?: ReadonlyArray<Record<string, any>>, regeln?: Record<string, any>,
 * }} daten
 * @param {Parameters<typeof projektControlling>[1]} [einstellung]
 * @returns {Array<{monat: string, minuten: number, K: number, dE: number|null, abgerechnet: number, DB: number|null}>} Euro
 */
export function monatsreihe(daten, einstellung = {}) {
  const { hoaiPlan = null, vertrag = null, nachtraege = [], buchungen = [], kostensaetze = [], mitarbeiter = [], rechnungen = [], regeln = {} } = daten || {};
  const { satzModus = "persoenlich", nurFreigegeben = false, stichtagIso } = einstellung;
  const stichtag = stichtagIso || new Date().toISOString().slice(0, 10);
  /** @type {SatzKontext} */
  const k = { satzModus, kostensaetze, mitarbeiter, buero: buerosatz(kostensaetze, mitarbeiter, stichtag, regeln.buerosatz ?? null) };
  const zaehlend = zaehlendeBuchungen(buchungen, { nurFreigegeben, stichtagIso });
  const verlauf = (Array.isArray(hoaiPlan?.verlauf) ? hoaiPlan.verlauf : []).filter((v) => typeof v?.monat === "string" && Array.isArray(v.progress))
    .sort((a, b) => a.monat.localeCompare(b.monat));
  const eigeneRechnungen = vertrag ? rechnungen.filter((r) => r?.honorarvertrag_id === vertrag.id && r.status === "gestellt" && r.art !== "storno" && typeof r.rechnungsdatum === "string") : [];

  // Fee per LPH (cents) from the same rule as projektControlling.
  const basis = vertrag ? projektControlling({ vertrag, nachtraege, hoaiPlan: null, buchungen: [], kostensaetze, mitarbeiter, regeln }, einstellung) : null;
  const info = leistungsbildInfo(vertrag?.leistungsbild || "gebaeude");
  const neun = info?.lph?.length === 9;
  /** @param {any} eintrag @returns {Record<number, number>} */
  const standAus = (eintrag) => Object.fromEntries((info?.lph || []).map((s, i) => [s.nr, Number(eintrag?.progress?.[i]) || 0]));

  const monate = new Set([...verlauf.map((v) => v.monat), ...zaehlend.map((b) => String(b.datum || "").slice(0, 7)).filter(Boolean), ...eigeneRechnungen.map((r) => r.rechnungsdatum.slice(0, 7))]);
  return [...monate].sort().map((monat) => {
    const kz = kosten(zaehlend.filter((b) => String(b.datum || "").startsWith(monat)), k);
    let dE = null;
    const i = verlauf.findIndex((v) => v.monat === monat);
    if (basis && neun && i > 0 && basis.summe.H !== null) {
      const vorher = standAus(verlauf[i - 1]);
      const jetzt = standAus(verlauf[i]);
      let c = 0;
      for (const z of basis.lph) c += Math.round((cent(z.H ?? 0) * ((jetzt[z.lph] ?? 0) - (vorher[z.lph] ?? 0))) / 100);
      dE = euro(c);
    }
    const abgerechnet = euro(eigeneRechnungen.filter((r) => r.rechnungsdatum.startsWith(monat)).reduce((a, r) => a + cent(r.netto), 0));
    return { monat, minuten: kz.minuten, K: euro(kz.cent), dE, abgerechnet, DB: dE === null ? null : rund2(dE - euro(kz.cent)) };
  });
}
