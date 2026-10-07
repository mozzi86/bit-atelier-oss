// Liquidity plan of the year clock (79-10, BUCH-08/BUCH-18, D-P79-18/19): pulls
// together expected receipts (79-02/grundlagen), expected expenses (79-04),
// planned drawings (79-06) and tax dates (79-01/79-05) into one event stream,
// then a monthly balance, tax-day coverage and the "send invoices by"
// deadlines. Conservative on purpose (D-P79-18): an overdue receivable is not
// a promise of money, so it never covers a tax date — a `warn`, not a `fail`,
// because that is a liability choice, not a bug.
//
// In:  bh.daten (13 accounting collections), effective settings, legal rates
//      (saetzeZum), the business year and a reference day 'YYYY-MM-DD'
//      (optionally bh.projekte for the per-client payment term, E-12).
// Out: pure, deterministic functions; amounts in whole cents (geld.js), dates
//      'YYYY-MM-DD'. No wall-clock reads — `heute` always comes from the caller.

import { parseTag, plusTage, tag, tageImMonat, tageZwischen } from "@core/lib/kalender/datum.js";
import { BUERO_STANDARD } from "./einstellungen.js";
import { steuerartenFuer, vorauszahlungsTermine } from "./steuertermine.js";
import { ustTermine } from "./umsatzsteuer.js";
import { erwarteteAusgaben } from "./ausgaben.js";
import { geplanteEntnahmen } from "./entnahmen.js";
import {
  bauherrSchluessel, erwarteterEingang, faelligAm, offenerBetragCent, rechnungsStatus, zahlungszielTage,
} from "./grundlagen.js";
import { euroZuCent } from "./geld.js";

/**
 * One event of the liquidity plan.
 * @typedef {{datum: string, art: "eingang"|"ausgabe"|"entnahme"|"steuer", betragCent: number,
 *   quelle: string, id: string, sicher: boolean}} Ereignis
 */

/**
 * Context every function of this module reads.
 *
 * `zusatzAbfluesse` (80-10 Task 7b, additiv): optional planned monthly
 * outflows from outside 79 — today only HR's Personal (Plan)
 * (`usePersonalkostenPlan.js`). Each entry becomes one Ereignis on the LAST
 * day of its month (`[ASSUMED]` Gehaltszahlung am Monatsende), so it flows
 * into `ausgaben`/`abfluss`/`posten` of that month and into every tagesSaldo
 * on or after it. Without this field every result stays byte-identical to
 * the 79-10 shape (deepEqual), because `ereignisse()` simply appends nothing.
 * @typedef {{daten: Record<string, any[]>, einst: Record<string, any>, saetze: Record<string, any>,
 *   jahr: number, heute: string, projekte?: any[],
 *   zusatzAbfluesse?: Array<{monat: string, betragCent: number, art: string}>}} Kontext
 */

/** @param {unknown} v @returns {number|null} */
const alsBetrag = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** @param {unknown} v @param {number} std @returns {number} whole days */
const tageOder = (v, std) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : std);

/** @param {{nenn: string}} a @param {{nenn: string}} b */
const nachNenn = (a, b) => (a.nenn < b.nenn ? -1 : a.nenn > b.nenn ? 1 : 0);

/**
 * Deadline parameters of the office (E-12): payment term, buffer before a tax
 * date and warning threshold. 0 is a valid stored choice (wirksameEinstellungen
 * allows 0–365 days), so only a missing or invalid value falls back — and then
 * to BUERO_STANDARD, the one place the defaults live.
 * @param {Record<string, any>|null|undefined} einst effective settings
 * @returns {{ziel: number, puffer: number, warnTageRest: number}} whole days each
 */
export function fristParameter(einst) {
  return {
    ziel: tageOder(einst?.zahlungsziel_tage, BUERO_STANDARD.zahlungsziel_tage),
    puffer: tageOder(einst?.puffer_tage, BUERO_STANDARD.puffer_tage),
    warnTageRest: tageOder(einst?.warn_tage_rest, BUERO_STANDARD.warn_tage_rest),
  };
}

/**
 * Taxes the OFFICE ACCOUNT pays: steuerartenFuer() (legal form E-04, VAT switch
 * E-09) without income tax unless `est_ueber_buero` is set — otherwise the
 * owner pays it privately, so it is neither an outflow nor a tax date of the
 * clock (79-RESEARCH "Rechtsform × Wirkung": ESt "vom Bürokonto nur bei
 * est_ueber_buero"). KSt/GewSt of a GmbH/UG are always the company's own.
 * @param {Record<string, any>|null|undefined} einst effective settings
 * @returns {Array<"est"|"kst"|"gewst"|"ust">}
 */
export function bueroSteuerarten(einst) {
  const estUeberBuero = (einst?.est_ueber_buero ?? BUERO_STANDARD.est_ueber_buero) === true;
  return steuerartenFuer(/** @type {any} */ (einst)).filter((art) => art !== "est" || estUeberBuero);
}

/**
 * Display label of a tax kind (literal t() calls, so the i18n guard sees them).
 * @param {string} art est | kst | gewst | ust | ust_svz
 * @param {(k: string) => string} t
 * @returns {string}
 */
export function steuerartText(art, t) {
  if (art === "est") return t("ESt");
  if (art === "kst") return t("KSt");
  if (art === "gewst") return t("GewSt");
  if (art === "ust") return t("USt");
  if (art === "ust_svz") return t("SVZ");
  return art;
}

/**
 * A recorded tax payment matching one prepayment date (est/kst/gewst): same
 * `art` and the same quarter's period. Once paid, the actual record replaces
 * the planned figure — a historical fact outranks a forecast.
 * @param {any[]} steuerzahlungen
 * @param {"est"|"kst"|"gewst"} art
 * @param {{von: string, bis: string}} zeitraum
 * @returns {any|null}
 */
function steuerzahlungFuerQuartal(steuerzahlungen, art, zeitraum) {
  return steuerzahlungen.find((z) => z?.art === art && z?.zeitraum?.von === zeitraum.von && z?.zeitraum?.bis === zeitraum.bis) || null;
}

/**
 * Quarter period [von, bis] for a prepayment date's quarter (Q1 Jan–Mar, …).
 * @param {number} jahr
 * @param {number} quartal 1–4
 * @returns {{von: string, bis: string}}
 */
function quartalsZeitraum(jahr, quartal) {
  const startMonat = (quartal - 1) * 3 + 1;
  const von = tag(jahr, startMonat, 1);
  const endMonat = startMonat + 2;
  const bisVorMonat = tag(jahr, endMonat + 1, 1);
  return { von, bis: /** @type {string} */ (plusTage(bisVorMonat, -1)) };
}

/**
 * All events of one calendar year: expected/actual receipts, expenses,
 * drawings and tax dates. A recorded tax payment replaces its planned entry;
 * an amount that is not known yet (est/kst/gewst without a stored rate, or a
 * legal form with no prepayment) is OMITTED here — steuerzahltage() draws its
 * mark from the tax-date list itself and shows "Betrag fehlt" for it.
 * @param {Kontext} kontext
 * @returns {Ereignis[]}
 */
export function ereignisse({ daten, einst, saetze, jahr, heute, zusatzAbfluesse }) {
  const von = tag(jahr, 1, 1);
  const bis = tag(jahr, 12, 31);
  /** @type {Ereignis[]} */
  const aus = [];

  // --- 80-10 Task 7b: additiver Kontext-Abfluss (Personal (Plan) u. Ä.) ---
  // Ein Eintrag je Monat des Jahres — Monate anderer Jahre wirken hier nicht
  // (ein Eintrag für 2025 wirkt im Jahr 2026 nicht, Behavior 13).
  for (const posten of Array.isArray(zusatzAbfluesse) ? zusatzAbfluesse : []) {
    if (!posten || typeof posten.monat !== "string" || !posten.monat.startsWith(String(jahr))) continue;
    const y = Number(posten.monat.slice(0, 4));
    const m = Number(posten.monat.slice(5, 7));
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) continue;
    const letzterTag = tag(y, m, tageImMonat(y, m));
    aus.push({ datum: letzterTag, art: "ausgabe", betragCent: Number(posten.betragCent) || 0, quelle: posten.art || "zusatz", id: `${posten.art || "zusatz"}-${posten.monat}`, sicher: false });
  }

  // --- Eingänge: Ist-Zahlungen + erwarteter Eingang (offen/teilbezahlt/geplant/entwurf) ---
  // erwarteterEingang() itself gates on status (grundlagen.js): "ueberfaellig",
  // "bezahlt" and "storniert" all yield null, so an overdue receivable never
  // becomes an expected inflow here (D-P79-18) without a second pass.
  const ausgang = Array.isArray(daten?.Ausgangsrechnung) ? daten.Ausgangsrechnung : [];
  for (const r of ausgang) {
    for (const z of Array.isArray(r?.zahlungen) ? r.zahlungen : []) {
      const d = parseTag(z?.datum);
      if (d && d >= von && d <= bis) aus.push({ datum: d, art: "eingang", betragCent: euroZuCent(z.betrag), quelle: "ausgangsrechnung", id: r.id, sicher: true });
    }
    const erwartet = erwarteterEingang(r, einst, heute);
    if (erwartet && erwartet.cent > 0 && erwartet.datum >= von && erwartet.datum <= bis) {
      aus.push({ datum: erwartet.datum, art: "eingang", betragCent: erwartet.cent, quelle: "ausgangsrechnung", id: r.id, sicher: erwartet.sicher });
    }
  }

  // --- Ausgänge: bezahlte Eingangsrechnungen (Ist) + erwarteteAusgaben (offen/wiederkehrend/versicherung) ---
  const eingang = Array.isArray(daten?.Eingangsrechnung) ? daten.Eingangsrechnung : [];
  for (const e of eingang) {
    const bezahltAm = parseTag(e?.bezahlt_am);
    if (bezahltAm && bezahltAm >= von && bezahltAm <= bis) aus.push({ datum: bezahltAm, art: "ausgabe", betragCent: euroZuCent(e.brutto), quelle: "eingangsrechnung", id: e.id, sicher: true });
  }
  for (const posten of erwarteteAusgaben(daten, von, bis)) {
    aus.push({ datum: posten.datum, art: "ausgabe", betragCent: posten.cent, quelle: posten.quelle, id: posten.id, sicher: false });
  }

  // --- Entnahmen: Ist + geplanteEntnahmen (leer bei GmbH/UG) ---
  const entnahmenIst = Array.isArray(daten?.Entnahme) ? daten.Entnahme : [];
  for (const en of entnahmenIst) {
    const d = parseTag(en?.datum);
    if (d && d >= von && d <= bis) aus.push({ datum: d, art: "entnahme", betragCent: euroZuCent(en.betrag), quelle: "entnahme", id: en.id, sicher: true });
  }
  const gesellschafter = Array.isArray(daten?.Gesellschafter) ? daten.Gesellschafter : [];
  for (const p of geplanteEntnahmen(gesellschafter, entnahmenIst, heute, jahr, einst)) {
    if (p.restCent > 0) aus.push({ datum: `${p.monat}-15`, art: "entnahme", betragCent: p.restCent, quelle: "entnahme-plan", id: `plan:${p.gesellschafter_id}:${p.monat}`, sicher: false });
  }

  // --- Steuern: Vorauszahlungen (est/kst/gewst) + USt, eine bezahlte Steuerzahlung ersetzt den Termin ---
  const steuerzahlungen = Array.isArray(daten?.Steuerzahlung) ? daten.Steuerzahlung : [];
  const arten = bueroSteuerarten(einst);
  for (const art of /** @type {Array<"est"|"kst"|"gewst">} */ (["est", "kst", "gewst"])) {
    if (!arten.includes(art)) continue;
    for (const termin of vorauszahlungsTermine(jahr, art, saetze)) {
      const zeitraum = quartalsZeitraum(jahr, /** @type {number} */ (termin.quartal));
      const gezahlt = steuerzahlungFuerQuartal(steuerzahlungen, art, zeitraum);
      if (gezahlt) {
        aus.push({ datum: /** @type {string} */ (parseTag(gezahlt.bezahlt_am) || termin.faellig), art: "steuer", betragCent: euroZuCent(gezahlt.betrag), quelle: art, id: `${art}:${termin.nenn}`, sicher: true });
        continue;
      }
      const geplant = alsBetrag(einst?.vorauszahlungen?.[jahr]?.[art]?.[/** @type {number} */ (termin.quartal) - 1]);
      if (geplant !== null) aus.push({ datum: termin.faellig, art: "steuer", betragCent: euroZuCent(geplant), quelle: art, id: `${art}:${termin.nenn}`, sicher: false });
    }
  }
  if (arten.includes("ust")) {
    for (const t of ustTermine(jahr, daten, einst, saetze, heute)) {
      if (typeof t.betragCent !== "number" || t.betragCent <= 0) continue; // a refund is not an outflow
      aus.push({ datum: t.faellig, art: "steuer", betragCent: t.betragCent, quelle: t.art, id: `${t.art}:${t.nenn}`, sicher: t.bezahlt != null });
    }
  }

  return aus;
}

/**
 * Start balance for `jahr` (cents) — its own kontostand_start, else the
 * PREVIOUS year's own end-of-year balance (recomputed from ITS start,
 * `tiefe` bounds the recursion), else 0 with a hint.
 * @param {number} jahr
 * @param {Record<string, any[]>} daten
 * @param {Record<string, any>} einst
 * @param {Record<string, any>} saetze
 * @param {string} heute
 * @param {number} [tiefe]
 * @param {Array<{monat: string, betragCent: number, art: string}>} [zusatzAbfluesse]
 * @returns {{cent: number, quelle: "eigen"|"vorjahresende"|"hinweis"}}
 */
function saldoStartFuer(jahr, daten, einst, saetze, heute, tiefe = 0, zusatzAbfluesse = []) {
  const eigener = einst?.kontostand_start?.[jahr];
  if (eigener && typeof eigener.betrag === "number") return { cent: euroZuCent(eigener.betrag), quelle: "eigen" };
  if (tiefe >= 3) return { cent: 0, quelle: "hinweis" };
  const vorjahr = einst?.kontostand_start?.[jahr - 1];
  if (!vorjahr || typeof vorjahr.betrag !== "number") return { cent: 0, quelle: "hinweis" };
  const roh = monatsModellRoh(jahr - 1, daten, einst, saetze, heute, tiefe + 1, zusatzAbfluesse);
  return { cent: roh.monate[11].saldoEndeCent, quelle: "vorjahresende" };
}

/**
 * Start balance of `jahr` and where it comes from: "eigen" (kontostand_start
 * of that year), "vorjahresende" (the previous year's planned end balance) or
 * "hinweis" (nothing stored — the clock runs from 0 and the tab says so).
 * @param {Kontext} kontext
 * @returns {{cent: number, quelle: "eigen"|"vorjahresende"|"hinweis"}} cents
 */
export function startSaldo({ daten, einst, saetze, jahr, heute, zusatzAbfluesse }) {
  return saldoStartFuer(jahr, daten, einst, saetze, heute, 0, zusatzAbfluesse);
}

/**
 * @param {number} jahr
 * @param {Record<string, any[]>} daten
 * @param {Record<string, any>} einst
 * @param {Record<string, any>} saetze
 * @param {string} heute
 * @param {number} tiefe
 * @param {Array<{monat: string, betragCent: number, art: string}>} [zusatzAbfluesse]
 */
function monatsModellRoh(jahr, daten, einst, saetze, heute, tiefe, zusatzAbfluesse = []) {
  const start = saldoStartFuer(jahr, daten, einst, saetze, heute, tiefe, zusatzAbfluesse);
  const alle = ereignisse({ daten, einst, saetze, jahr, heute, zusatzAbfluesse }).sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
  /** @type {Array<{eingaengeCent: number, ausgabenCent: number, entnahmenCent: number, steuernCent: number, abflussCent: number, saldoAnfangCent: number, saldoEndeCent: number, posten: Ereignis[]}>} */
  const monate = [];
  let laufend = start.cent;
  for (let m = 1; m <= 12; m++) {
    const von = tag(jahr, m, 1), bis = tag(jahr, m + 1, 1);
    const posten = alle.filter((e) => e.datum >= von && e.datum < bis);
    const eingaengeCent = posten.filter((e) => e.art === "eingang").reduce((n, e) => n + e.betragCent, 0);
    const ausgabenCent = posten.filter((e) => e.art === "ausgabe").reduce((n, e) => n + e.betragCent, 0);
    const entnahmenCent = posten.filter((e) => e.art === "entnahme").reduce((n, e) => n + e.betragCent, 0);
    const steuernCent = posten.filter((e) => e.art === "steuer").reduce((n, e) => n + e.betragCent, 0);
    const abflussCent = ausgabenCent + entnahmenCent + steuernCent;
    const saldoAnfangCent = laufend;
    const saldoEndeCent = saldoAnfangCent + eingaengeCent - abflussCent;
    monate.push({ eingaengeCent, ausgabenCent, entnahmenCent, steuernCent, abflussCent, saldoAnfangCent, saldoEndeCent, posten });
    laufend = saldoEndeCent;
  }
  return { monate, start, alleEreignisse: alle };
}

/**
 * Balance at the end of `datum` from a computed year model: every event up
 * to and including that day. Same-day receipts count — the sum makes the order
 * irrelevant, so a receipt on the due day still covers that day's tax.
 * @param {ReturnType<typeof monatsModellRoh>} roh
 * @param {string} datum 'YYYY-MM-DD'
 * @returns {number} cents
 */
function saldoAmTag(roh, datum) {
  let saldo = roh.start.cent;
  for (const e of roh.alleEreignisse) {
    if (e.datum > datum) break;
    saldo += e.art === "eingang" ? e.betragCent : -e.betragCent;
  }
  return saldo;
}

/**
 * The 12 monthly figures of `jahr`, running from its start balance.
 * @param {Kontext} kontext
 * @returns {Array<{eingaengeCent: number, ausgabenCent: number, entnahmenCent: number, steuernCent: number,
 *   abflussCent: number, saldoAnfangCent: number, saldoEndeCent: number, posten: Ereignis[]}>}
 */
export function monatsModell({ daten, einst, saetze, jahr, heute, zusatzAbfluesse }) {
  return monatsModellRoh(jahr, daten, einst, saetze, heute, 0, zusatzAbfluesse).monate;
}

/**
 * Balance on one exact day (all events of `jahr` up to and including that
 * day; same-day receipts count before outflows — for a plain sum the order
 * makes no difference, but a same-day receipt still counts as coverage).
 * @param {Kontext} kontext
 * @param {string} datum 'YYYY-MM-DD'
 * @returns {number} cents
 */
export function tagesSaldo(kontext, datum) {
  return saldoAmTag(monatsModellRoh(kontext.jahr, kontext.daten, kontext.einst, kontext.saetze, kontext.heute, 0, kontext.zusatzAbfluesse), datum);
}

/**
 * Latest date to still send an invoice so its payment can cover a tax date
 * due on `nenn` (its statutory date, not the working-day-adjusted one — a
 * conservative, fixed offset independent of weekday shifts): nenn − ziel − puffer.
 * @param {string} nenn 'YYYY-MM-DD'
 * @param {number} ziel payment term, days
 * @param {number} puffer buffer, days
 * @returns {string|null}
 */
export function spaetesterVersand(nenn, ziel, puffer) {
  return plusTage(nenn, -(Number(ziel) + Number(puffer)));
}

/**
 * @typedef {{arten: string[], nenn: string, faellig: string, betragCent: number|null, fehlendeArten: string[],
 *   saldoAm: number, gedeckt: boolean|null, spaetesterVersand: string, restTage: number|null,
 *   warnung: "knapp"|"ueberschritten"|null}} SteuerTag
 */

/**
 * Tax dates of `jahr` grouped by statutory date (`nenn`): every prepayment the
 * office account pays (bueroSteuerarten) and every VAT date whose `nenn` falls
 * in `jahr`, one entry per shared `nenn` with all its tax types.
 * - betragCent: sum of the KNOWN amounts; null only when no amount is known.
 *   fehlendeArten names the types without an amount ("Betrag fehlt").
 * - gedeckt: the running balance at the end of the working-day-adjusted due
 *   date. A negative balance is uncovered whatever is missing; a non-negative
 *   one only counts as covered when every amount is known — otherwise null
 *   ("Deckung unbekannt"). Conservative (D-P79-18): never an optimistic ✓.
 * - warnung: "ueberschritten" when the office deadline has passed and the date
 *   is uncovered, "knapp" when fewer than warn_tage_rest days are left.
 * @param {Kontext} kontext
 * @returns {SteuerTag[]} sorted by nenn
 */
export function steuerzahltage(kontext) {
  const { daten, einst, saetze, jahr, heute, zusatzAbfluesse } = kontext;
  const arten = bueroSteuerarten(einst);
  const steuerzahlungen = Array.isArray(daten?.Steuerzahlung) ? daten.Steuerzahlung : [];
  /** @type {Map<string, {arten: string[], faellig: string, bekanntCent: number, fehlend: string[]}>} */
  const gruppen = new Map();
  /** @param {string} nenn @param {string} faellig @param {string} art @param {number|null} betragCent */
  const eintragen = (nenn, faellig, art, betragCent) => {
    const eintrag = gruppen.get(nenn) || { arten: [], faellig, bekanntCent: 0, fehlend: [] };
    if (!eintrag.arten.includes(art)) eintrag.arten.push(art);
    if (betragCent === null) { if (!eintrag.fehlend.includes(art)) eintrag.fehlend.push(art); }
    else eintrag.bekanntCent += betragCent;
    gruppen.set(nenn, eintrag);
  };

  for (const art of /** @type {Array<"est"|"kst"|"gewst">} */ (["est", "kst", "gewst"])) {
    if (!arten.includes(art)) continue;
    for (const termin of vorauszahlungsTermine(jahr, art, saetze)) {
      const zeitraum = quartalsZeitraum(jahr, /** @type {number} */ (termin.quartal));
      const gezahlt = steuerzahlungFuerQuartal(steuerzahlungen, art, zeitraum);
      const geplant = alsBetrag(einst?.vorauszahlungen?.[jahr]?.[art]?.[/** @type {number} */ (termin.quartal) - 1]);
      const betrag = gezahlt ? euroZuCent(gezahlt.betrag) : geplant === null ? null : euroZuCent(geplant);
      eintragen(termin.nenn, termin.faellig, art, betrag);
    }
  }
  if (arten.includes("ust")) {
    for (const t of ustTermine(jahr, daten, einst, saetze, heute)) {
      // A refund (negative VAT liability) needs no cover: counted as 0.
      eintragen(t.nenn, t.faellig, t.art, typeof t.betragCent === "number" ? Math.max(0, t.betragCent) : null);
    }
  }

  const { ziel, puffer, warnTageRest } = fristParameter(einst);
  const roh = monatsModellRoh(jahr, daten, einst, saetze, heute, 0, zusatzAbfluesse);

  /** @type {SteuerTag[]} */
  const aus = [];
  for (const [nenn, g] of gruppen) {
    const saldoAm = saldoAmTag(roh, g.faellig);
    const betragCent = g.fehlend.length === g.arten.length ? null : g.bekanntCent;
    const gedeckt = saldoAm < 0 ? false : g.fehlend.length > 0 ? null : true;
    const versand = /** @type {string} */ (spaetesterVersand(nenn, ziel, puffer));
    const restTage = tageZwischen(heute, versand);
    let warnung = /** @type {"knapp"|"ueberschritten"|null} */ (null);
    if (restTage !== null) {
      if (restTage < 0 && gedeckt === false) warnung = "ueberschritten";
      else if (restTage >= 0 && restTage < warnTageRest) warnung = "knapp";
    }
    aus.push({ arten: g.arten, nenn, faellig: g.faellig, betragCent, fehlendeArten: g.fehlend, saldoAm, gedeckt, spaetesterVersand: versand, restTage, warnung });
  }
  return aus.sort(nachNenn);
}

/**
 * Tax dates of several years in one list (each year's list only holds dates
 * whose `nenn` lies in that year, so the union has no duplicates).
 * @param {Kontext} kontext
 * @param {number[]} jahre
 * @returns {SteuerTag[]} sorted by nenn
 */
function steuertageJahre(kontext, jahre) {
  const eindeutig = [...new Set(jahre.filter((j) => Number.isInteger(j)))].sort((a, b) => a - b);
  return eindeutig.flatMap((j) => steuerzahltage({ ...kontext, jahr: j })).sort(nachNenn);
}

/**
 * @typedef {{id: string, nummer?: string, frist: string, zielTage: number,
 *   warnung: "knapp"|"ueberschritten"|null}} RausRechnung
 */

/**
 * Assigns every planned/draft invoice to a tax date (79-10 T2):
 * - normally the EARLIEST tax date on or after `heute` whose own deadline
 *   (statutory date − this invoice's payment term − buffer) is still on or
 *   after `heute`; "knapp" when fewer than warn_tage_rest days are left;
 * - exception: when the deadline for the NEXT tax date has already passed and
 *   that date is uncovered, the invoice stays there, marked "ueberschritten" —
 *   the gap must be visible, not silently pushed to a later quarter.
 * Payment term per invoice by the E-12 chain (grundlagen.zahlungszielTage):
 * invoice > fee contract > per-client map > office default.
 * @param {Kontext} kontext
 * @param {SteuerTag[]} steuertage candidates, sorted by nenn
 * @returns {Map<string, RausRechnung[]>} nenn → assigned invoices
 */
function rausZuordnung(kontext, steuertage) {
  const { daten, einst, heute } = kontext;
  const { puffer, warnTageRest } = fristParameter(einst);
  const vertraege = new Map((Array.isArray(daten?.Honorarvertrag) ? daten.Honorarvertrag : []).map((v) => [v?.id, v]));
  const projekte = new Map((Array.isArray(kontext.projekte) ? kontext.projekte : []).map((p) => [p?.id, p]));
  const kuenftige = steuertage.filter((st) => st.nenn >= heute);
  /** @type {Map<string, RausRechnung[]>} */
  const zuordnung = new Map();
  if (kuenftige.length === 0) return zuordnung;
  const naechster = kuenftige[0];

  const ausgang = Array.isArray(daten?.Ausgangsrechnung) ? daten.Ausgangsrechnung : [];
  for (const r of ausgang) {
    if (r?.status !== "geplant" && r?.status !== "entwurf") continue;
    const vertrag = vertraege.get(r.honorarvertrag_id) || null;
    const projekt = projekte.get(r.project_id) || null;
    const zielTage = zahlungszielTage({ rechnung: r, vertrag, einst: /** @type {any} */ (einst), bauherrSchluessel: bauherrSchluessel(vertrag, projekt) });
    /** @param {SteuerTag} st */
    const eigeneFrist = (st) => /** @type {string} */ (spaetesterVersand(st.nenn, zielTage, puffer));

    /** @type {SteuerTag|null} */
    let ziel = null;
    let warnung = /** @type {"knapp"|"ueberschritten"|null} */ (null);
    if (eigeneFrist(naechster) < heute && naechster.gedeckt === false) {
      ziel = naechster;
      warnung = "ueberschritten";
    } else {
      ziel = kuenftige.find((st) => eigeneFrist(st) >= heute) || null;
      const rest = ziel ? tageZwischen(heute, eigeneFrist(ziel)) : null;
      if (rest !== null && rest < warnTageRest) warnung = "knapp";
    }
    if (!ziel) continue;
    const liste = zuordnung.get(ziel.nenn) || [];
    liste.push({ id: r.id, nummer: r.nummer, frist: eigeneFrist(ziel), zielTage, warnung });
    zuordnung.set(ziel.nenn, liste);
  }
  return zuordnung;
}

/**
 * @typedef {{datum: string, arten: string[], betragCent: number|null, fehlendeArten: string[], gedeckt: boolean|null,
 *   spaetesterVersand: string, restTage: number|null, warnung: "knapp"|"ueberschritten"|null,
 *   rechnungen: RausRechnung[]}} RechnungRausEintrag
 */

/**
 * The "Rechnungen raus bis" list of `jahr`: every tax date of `jahr` (a
 * January date's deadline lies in the prior year and is shown with it) plus
 * the dates of `jahr + 1` whose office deadline already falls in `jahr` —
 * each with the planned/draft invoices assigned to it (rausZuordnung). The
 * assignment itself always looks at the tax dates around `heute`, whatever
 * year is shown.
 * @param {Kontext} kontext
 * @returns {RechnungRausEintrag[]} sorted by date
 */
export function rechnungenRausBis(kontext) {
  const { jahr, heute } = kontext;
  const heuteJahr = Number(String(heute).slice(0, 4));
  const steuertage = steuertageJahre(kontext, [jahr, jahr + 1, heuteJahr, heuteJahr + 1]);
  const zuordnung = rausZuordnung(kontext, steuertage);
  const j = String(jahr);
  return steuertage
    .filter((st) => st.nenn.startsWith(j) || String(st.spaetesterVersand).startsWith(j))
    .map((st) => ({
      datum: st.nenn, arten: st.arten, betragCent: st.betragCent, fehlendeArten: st.fehlendeArten, gedeckt: st.gedeckt,
      spaetesterVersand: st.spaetesterVersand, restTage: st.restTage, warnung: st.warnung,
      rechnungen: zuordnung.get(st.nenn) || [],
    }));
}

/**
 * Overdue receivables on `heute` — the same status the invoice list shows
 * (grundlagen.rechnungsStatus: due date incl. payment term, payments up to
 * `heute`). They never count as cover (D-P79-18); the tab lists them marked.
 * @param {{daten: Record<string, any[]>, heute: string}} kontext
 * @returns {Array<{id: string, nummer?: string, faellig: string|null, offenCent: number}>}
 */
export function ueberfaelligeForderungen({ daten, heute }) {
  const ausgang = Array.isArray(daten?.Ausgangsrechnung) ? daten.Ausgangsrechnung : [];
  return ausgang
    .filter((r) => rechnungsStatus(r, heute) === "ueberfaellig")
    .map((r) => ({ id: r.id, nummer: r.nummer, faellig: faelligAm(r), offenCent: offenerBetragCent(r, heute) }));
}

/**
 * Overdue receivables, the next tax date, the next "send by" deadline with
 * the number of invoices assigned to its tax date, and today's balance — the
 * status bar above every tab (LageLeiste.jsx). Always computed around `heute`
 * (its year and the next), whatever year the clock shows.
 * @param {Kontext} kontext
 * @returns {{ueberfaellig: {anzahl: number, summeCent: number}, naechsterSteuertag: SteuerTag|null,
 *   naechsteFrist: {datum: string, tage: number, nenn: string, arten: string[], rechnungen: number}|null,
 *   kontostandHeute: number}}
 */
export function lage(kontext) {
  const { heute } = kontext;
  const heuteJahr = Number(String(heute).slice(0, 4));
  const k = { ...kontext, jahr: heuteJahr };
  const offen = ueberfaelligeForderungen(k);
  const steuertage = steuertageJahre(k, [heuteJahr, heuteJahr + 1]);

  const naechsterSteuertag = [...steuertage]
    .sort((a, b) => (a.faellig < b.faellig ? -1 : a.faellig > b.faellig ? 1 : 0))
    .find((st) => st.faellig >= heute) || null;
  const fristTag = steuertage
    .filter((st) => st.spaetesterVersand >= heute)
    .sort((a, b) => (a.spaetesterVersand < b.spaetesterVersand ? -1 : a.spaetesterVersand > b.spaetesterVersand ? 1 : 0))[0] || null;
  const zuordnung = rausZuordnung(k, steuertage);
  const naechsteFrist = fristTag ? {
    datum: fristTag.spaetesterVersand,
    tage: /** @type {number} */ (tageZwischen(heute, fristTag.spaetesterVersand)),
    nenn: fristTag.nenn,
    arten: fristTag.arten,
    rechnungen: (zuordnung.get(fristTag.nenn) || []).length,
  } : null;

  return {
    ueberfaellig: { anzahl: offen.length, summeCent: offen.reduce((n, r) => n + r.offenCent, 0) },
    naechsterSteuertag,
    naechsteFrist,
    kontostandHeute: tagesSaldo(k, heute),
  };
}

/**
 * Export table model of the monthly figures (CSV/XLSX, gemeinsam/ExportKnopf).
 * @param {ReturnType<typeof monatsModell>} modell
 * @param {(k: string) => string} t
 * @returns {import("./tabellenExport.js").Tabellenmodell}
 */
export function liquiditaetTabelle(modell, t) {
  return {
    titel: t("Liquiditätsplanung"),
    spalten: [
      { key: "monat", label: t("Monat"), typ: "text" },
      { key: "eingaenge", label: t("Eingänge"), typ: "betrag" },
      { key: "abfluss", label: t("Abfluss"), typ: "betrag" },
      { key: "saldoEnde", label: t("Saldo Ende"), typ: "betrag" },
    ],
    zeilen: modell.map((m, i) => ({
      monat: String(i + 1).padStart(2, "0"),
      eingaenge: m.eingaengeCent / 100,
      abfluss: m.abflussCent / 100,
      saldoEnde: m.saldoEndeCent / 100,
    })),
  };
}
