// Dunning of the accounting module (phase 79-03, BUCH-06): the overdue list,
// when default interest starts (§ 286 BGB), the interest itself split at every
// base-rate change (§ 288 BGB, act/365), the EUR 40 flat fee (§ 288 Abs. 5
// BGB, businesses only, like the interest only once in default — forderungAm())
// and the three dunning levels. mahnTextFelder() turns
// one level into the letter's text fields (recipient/sender/table for
// mahnPdf.js's mahnBrief()); mahnTabelle() turns the already-computed rows the
// section shows into an export model — screen and export can never disagree.
//
// Every function is pure. None of this is legal advice (RichtwertHinweis on
// every /Accounting tab already says so); each rule below carries its own
// "warn, keine Rechtsaussage" comment where the reading of the BGB is not
// beyond doubt.
//
// In:  Ausgangsrechnung/Honorarvertrag records, effective settings, a
//      reference date. Out: plain values, a letter-fields object, one export
//      table model. No entity access, no clock reads.

import { parseTag, plusTage, tageZwischen } from "@core/lib/kalender/datum.js";
import { briefkopfZeilen } from "@core/lib/brief/briefkopf.js";
import { GESETZ, BUERO_STANDARD, alsRegeln, basiszinsAm, saetzeZum, veralteteWerte } from "./einstellungen.js";
import { faelligAm, rechnungsStatus, offenerBetragCent } from "./grundlagen.js";
import { euroZuCent, centZuEuro, rundeCent, formatEuro } from "./geld.js";

/**
 * Value of a dated GESETZ row that is either always current (SEIT_JEHER, one
 * row) or looked up on a date. `zeileAm` of einstellungen.js is not exported,
 * so this is reimplemented here rather than reached into that module's
 * internals — see 79-03-PLAN.md read_first.
 * @param {ReadonlyArray<{ab: string, wert: any}>} zeilen sorted by `ab`
 * @param {string|null} [datum] 'YYYY-MM-DD'; omitted = the last (most recent) row
 * @returns {any}
 */
function wertAm(zeilen, datum = null) {
  let treffer = null;
  for (const z of zeilen) if (!datum || z.ab <= datum) treffer = z;
  return treffer ? treffer.wert : undefined;
}

/**
 * Gapless calendar dates '{jahr}-01-01' / '{jahr}-07-01' — the base-rate change
 * dates (§ 247 BGB) — strictly after `von` and up to and including `bis`.
 * @param {string} von 'YYYY-MM-DD'
 * @param {string} bis 'YYYY-MM-DD'
 * @returns {string[]} sorted ascending
 */
function basiszinsWechsel(von, bis) {
  const ausgabe = [];
  const jahrVon = Number(von.slice(0, 4));
  const jahrBis = Number(bis.slice(0, 4));
  for (let jahr = jahrVon; jahr <= jahrBis + 1; jahr++) {
    for (const tag of [`${jahr}-01-01`, `${jahr}-07-01`]) {
      if (tag > von && tag <= bis) ausgabe.push(tag);
    }
  }
  return ausgabe.sort();
}

/** @param {string} datum 'YYYY-MM-DD' @returns {string} base-rate half-year, e.g. "2026-2" (the rate is fixed per 01.01./01.07.) */
const halbjahr = (datum) => `${datum.slice(0, 4)}-${Number(datum.slice(5, 7)) <= 6 ? 1 : 2}`;

/**
 * Base rate of one interest sub-period that starts on `periodenStart`: the
 * injected rates' own value when the sub-period lies in the half-year of their
 * `stichtag`, otherwise the dated table (earlier half-years keep their
 * historical rate). Sub-periods are split exactly at 01.01./01.07., so each
 * lies in one half-year. With an unmodified saetzeZum() snapshot both sources
 * give the same number; a changed rate copy now reaches the calculation instead
 * of being ignored (79-RESEARCH: every calculation gets its rates injected —
 * found by the 79-13 integration probe).
 * @param {string} periodenStart 'YYYY-MM-DD'
 * @param {Record<string, any>} saetze saetzeZum(…) or a modified copy of it
 * @returns {number|null} percent
 */
function basiszinsFuer(periodenStart, saetze) {
  const wert = saetze?.verzug?.basiszins;
  const stichtag = saetze?.stichtag;
  if (typeof wert === "number" && Number.isFinite(wert) && typeof stichtag === "string" && halbjahr(stichtag) === halbjahr(periodenStart)) return wert;
  return basiszinsAm(periodenStart);
}

/**
 * Overdue invoices: issued, not yet fully paid, past their due date
 * (grundlagen.rechnungsStatus === "ueberfaellig" — computed, never stored).
 * @param {ReadonlyArray<Record<string, any>>} daten Ausgangsrechnung[]
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {Record<string, any>[]}
 */
export function ueberfaellige(daten, heute) {
  return (daten || []).filter((r) => rechnungsStatus(r, heute) === "ueberfaellig");
}

/**
 * First day default interest runs (§ 286 BGB) — a warning, not a legal
 * opinion (the BGH line on a one-sided payment term is not checked against
 * the full text, 79-RESEARCH "Verzug & Mahnwesen").
 *
 * With a contractually agreed term (Honorarvertrag.zahlungsziel_vertraglich):
 * the day after the due date (§ 286 Abs. 2 Nr. 1 BGB — a calendar-determined
 * date needs no reminder), regardless of the client's kind.
 *
 * Otherwise, the EARLIER of two triggers (§ 286 Abs. 1 and Abs. 3 BGB): the
 * day after the first dunning letter's access (assumed to be its `datum`,
 * `[ASSUMED]` — no separate "Zugang" field is recorded), and the day after
 * the due date plus the statutory grace period (default 30 days). For a
 * consumer, the 30-day trigger only applies with the invoice's own notice
 * (`verzugshinweis`, § 286 Abs. 3 S. 1 BGB) — a first dunning letter still
 * starts it, consumer or not, because a reminder is the ordinary § 286 Abs. 1
 * trigger and needs no such notice.
 * @param {{faellig_am?: string, rechnungsdatum?: string, versand_geplant_am?: string,
 *   zahlungsziel_tage?: number, verzugshinweis?: boolean, mahnungen?: Array<{stufe: number, datum: string}>}} rechnung
 * @param {{zahlungsziel_vertraglich?: boolean}|null|undefined} vertrag
 * @param {"unternehmer"|"verbraucher"|"oeffentlich"} bauherrArt
 * @returns {{datum: string|null, quelle: "vertrag"|"mahnung"|"30_tage"|null}}
 */
export function verzugsbeginn(rechnung, vertrag, bauherrArt) {
  const faellig = faelligAm(rechnung);
  if (!faellig) return { datum: null, quelle: null };

  if (vertrag?.zahlungsziel_vertraglich) {
    return { datum: /** @type {string} */ (plusTage(faellig, 1)), quelle: "vertrag" };
  }

  /** @type {Array<{datum: string, quelle: "mahnung"|"30_tage"}>} */
  const kandidaten = [];
  if (bauherrArt !== "verbraucher" || rechnung?.verzugshinweis) {
    const tage30 = wertAm(GESETZ.VERZUG.verzug_30_tage);
    kandidaten.push({ datum: /** @type {string} */ (plusTage(faellig, tage30 + 1)), quelle: "30_tage" });
  }
  const mahnungStufe1 = (rechnung?.mahnungen || []).find((m) => m?.stufe === 1);
  if (mahnungStufe1?.datum && parseTag(mahnungStufe1.datum)) {
    kandidaten.push({ datum: /** @type {string} */ (plusTage(mahnungStufe1.datum, 1)), quelle: "mahnung" });
  }
  if (!kandidaten.length) return { datum: null, quelle: null };
  kandidaten.sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
  return kandidaten[0];
}

/**
 * Default interest (§ 288 BGB), act/365, split into one sub-period per
 * base-rate change (01.01./01.07., § 247 BGB) so each period uses its own
 * rate; every sub-period is rounded to the cent on its own (the sum of the
 * parts, not the whole, is the amount actually owed for each stretch of
 * time). `von`/`bis` both count (both inclusive). The half-year of
 * `saetze.stichtag` takes its base rate from `saetze` (basiszinsFuer), every
 * earlier one from the dated table.
 * @param {number} cent principal (the amount in default), whole cents
 * @param {string} von first day of default 'YYYY-MM-DD'
 * @param {string} bis last day to charge interest for (inclusive) 'YYYY-MM-DD'
 * @param {"unternehmer"|"verbraucher"|"oeffentlich"} bauherrArt
 * @param {Record<string, any>} [saetze] saetzeZum(…); default: rates on `bis`
 * @returns {{cent: number, perioden: Array<{von: string, bis: string, tage: number, basiszins: number, satz: number, cent: number}>}}
 */
export function verzugszinsen(cent, von, bis, bauherrArt, saetze = saetzeZum(bis)) {
  const start = parseTag(von);
  const ende = parseTag(bis);
  if (!start || !ende || start > ende || !cent) return { cent: 0, perioden: [] };

  const pp = bauherrArt === "verbraucher" ? saetze.verzug.pp_verbraucher : saetze.verzug.pp_unternehmer;
  const tageJahr = saetze.verzug.tage_jahr;
  const grenzen = [...basiszinsWechsel(start, ende), /** @type {string} */ (plusTage(ende, 1))];

  const perioden = [];
  let periodenStart = start;
  for (const grenze of grenzen) {
    const periodenEnde = /** @type {string} */ (plusTage(grenze, -1));
    const tage = /** @type {number} */ (tageZwischen(periodenStart, periodenEnde)) + 1;
    const basiszins = /** @type {number} */ (basiszinsFuer(periodenStart, saetze));
    const satz = basiszins + pp;
    const periodenCent = rundeCent((cent * satz * tage) / (100 * tageJahr));
    perioden.push({ von: periodenStart, bis: periodenEnde, tage, basiszins, satz, cent: periodenCent });
    periodenStart = grenze;
  }
  return { cent: perioden.reduce((n, p) => n + p.cent, 0), perioden };
}

/**
 * EUR 40 flat fee (§ 288 Abs. 5 BGB): once per invoice, never against a
 * consumer, not again once an earlier dunning entry already carries one.
 * Does NOT check whether default has begun — forderungAm() gates it on that.
 * @param {{mahnungen?: Array<{pauschale?: number}>}} rechnung
 * @param {"unternehmer"|"verbraucher"|"oeffentlich"} bauherrArt
 * @returns {number} cents (0 when it does not apply)
 */
export function pauschale(rechnung, bauherrArt) {
  if (bauherrArt === "verbraucher") return 0;
  const schonEnthalten = (rechnung?.mahnungen || []).some((m) => Number(m?.pauschale) > 0);
  if (schonEnthalten) return 0;
  return euroZuCent(wertAm(GESETZ.VERZUG.pauschale));
}

/**
 * What an overdue invoice is owed on one day — the single computation the
 * dunning list (MahnwesenAbschnitt.jsx) and the letter (mahnTextFelder) share.
 * Interest AND the flat fee both wait for default (`verzugsbeginn ≤ heute`):
 * § 288 Abs. 5 BGB grants the fee only "bei Verzug des Schuldners", the same
 * precondition as the interest of Abs. 1/2, so a reminder sent before that day
 * (e.g. stage 1 at due + 7 days while the 30-day rule runs to due + 31) must not
 * demand it — and must not record it in the append-only mahnungen[].
 * @param {Record<string, any>} rechnung Ausgangsrechnung
 * @param {{zahlungsziel_vertraglich?: boolean, bauherr_art?: string}|null|undefined} vertrag Honorarvertrag
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {{
 *   bauherrArt: "unternehmer"|"verbraucher"|"oeffentlich",
 *   verzugsbeginn: {datum: string|null, quelle: "vertrag"|"mahnung"|"30_tage"|null},
 *   offenCent: number, zinsen: {cent: number, perioden: Array<Record<string, any>>}, pauschaleCent: number,
 * }} amounts in whole cents
 */
export function forderungAm(rechnung, vertrag, heute) {
  const bauherrArt = rechnung?.empfaenger?.art || vertrag?.bauherr_art || "unternehmer";
  const verzug = verzugsbeginn(rechnung, vertrag, bauherrArt);
  const offenCent = offenerBetragCent(rechnung, heute);
  const imVerzug = Boolean(verzug.datum && verzug.datum <= heute);
  const zinsen = imVerzug
    ? verzugszinsen(offenCent, /** @type {string} */ (verzug.datum), heute, bauherrArt)
    : { cent: 0, perioden: [] };
  const pauschaleCent = imVerzug ? pauschale(rechnung, bauherrArt) : 0;
  return { bauherrArt, verzugsbeginn: verzug, offenCent, zinsen, pauschaleCent };
}

/**
 * The next dunning level after whatever was last recorded (or the first, when
 * none was) — computed regardless of whether its date has already arrived,
 * so a forward-looking "Fällige Stufe ab" column can show it before it is
 * actually due; null only once the last configured level (default: stage 3)
 * has already been sent. The first level counts from the due date
 * (`tage_nach_faellig`); every later level counts from the date the previous
 * level was recorded (`tage_nach_vorstufe`) — the settings block in
 * MahnwesenAbschnitt.jsx edits both figures per level, plus each level's own
 * deadline length (`frist_tage`, gesetzlich nicht geregelt, `[ASSUMED]`).
 * @param {{faellig_am?: string, rechnungsdatum?: string, mahnungen?: Array<{stufe: number, datum: string}>}} rechnung
 * @param {ReadonlyArray<{stufe: number, tage_nach_faellig?: number, tage_nach_vorstufe?: number, frist_tage?: number}>} [stufen] einst.mahnstufen
 * @returns {{stufe: number, ab: string, frist: string}|null}
 */
export function naechsteMahnstufe(rechnung, stufen) {
  const faellig = faelligAm(rechnung);
  if (!faellig) return null;
  const liste = Array.isArray(stufen) && stufen.length ? stufen : BUERO_STANDARD.mahnstufen;
  const mahnungen = Array.isArray(rechnung?.mahnungen)
    ? [...rechnung.mahnungen].sort((a, b) => (a?.stufe || 0) - (b?.stufe || 0))
    : [];
  const letzte = mahnungen[mahnungen.length - 1] || null;
  const naechsteNr = (letzte?.stufe || 0) + 1;
  const stufeDef = liste.find((s) => s.stufe === naechsteNr);
  if (!stufeDef) return null;
  const basis = letzte ? letzte.datum : faellig;
  const tage = letzte ? (stufeDef.tage_nach_vorstufe ?? 0) : (stufeDef.tage_nach_faellig ?? 0);
  const ab = parseTag(basis) && plusTage(/** @type {string} */ (basis), tage);
  if (!ab) return null;
  const frist = /** @type {string} */ (plusTage(ab, stufeDef.frist_tage ?? 0));
  return { stufe: stufeDef.stufe, ab, frist };
}

/**
 * The next dunning level, but only when it is due TODAY (`heute >= ab`) — the
 * gate for the "Mahnung Stufe n erstellen" action (naechsteMahnstufe() alone
 * would offer it before its date has arrived).
 * @param {{faellig_am?: string, rechnungsdatum?: string, mahnungen?: Array<{stufe: number, datum: string}>}} rechnung
 * @param {string} heute 'YYYY-MM-DD'
 * @param {ReadonlyArray<{stufe: number, tage_nach_faellig?: number, tage_nach_vorstufe?: number, frist_tage?: number}>} [stufen] einst.mahnstufen
 * @returns {{stufe: number, ab: string, frist: string}|null}
 */
export function faelligeMahnstufe(rechnung, heute, stufen) {
  const naechste = naechsteMahnstufe(rechnung, stufen);
  return naechste && heute >= naechste.ab ? naechste : null;
}

/**
 * Whether the base rate table (§ 247 BGB) may be out of date on a day, and
 * since when the last known rate has applied — for the UI hint
 * "Basiszinssatz prüfen (Stand …)" in MahnwesenAbschnitt.jsx. Reuses
 * einstellungen.veralteteWerte()/alsRegeln() (79-01) instead of re-deriving
 * the change date, so the two can never disagree.
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {string|null} the last known rate's `ab` date; null while current
 */
export function basiszinsStandWarnung(heute) {
  if (!veralteteWerte(heute).some((w) => w.regel === "buchhaltung.basiszins")) return null;
  const regel = alsRegeln().find((r) => r.id === "buchhaltung.basiszins");
  const zeilen = (regel?.werte || []).filter((z) => z.ab <= heute);
  return zeilen.length ? zeilen[zeilen.length - 1].ab : null;
}

/** dd.mm.yyyy for a letter; "" for a missing/invalid date. */
function tagFuerBrief(iso) {
  const s = parseTag(iso);
  return s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : "";
}

/**
 * Betreff/Anrede/text paragraphs and the amount table of one dunning letter,
 * ready for mahnPdf.mahnBrief(). Level 1 is a plain reminder (no amount
 * beyond the invoice itself has accrued yet by convention — interest and the
 * flat fee, once they exist, are still named so the recipient is not
 * surprised later); levels 2 and 3 name the current total. Level 3 announces
 * the judicial dunning procedure (Mahnbescheid), no further notice promised.
 * @param {Record<string, any>} rechnung Ausgangsrechnung
 * @param {number} stufe 1 | 2 | 3
 * @param {{
 *   heute: string, einst: Record<string, any>, briefkopf?: Record<string, any>,
 *   vertrag?: Record<string, any>|null, frist?: string,
 * }} ctx heute: letter date; frist: overridable new deadline (default: faelligeMahnstufe's)
 * @param {(schluessel: string) => string} t
 * @returns {{
 *   betreff: string, anrede: string, absaetze: string[],
 *   tabelle: {kopf: string[], zeilen: string[][]},
 *   absenderZeilen: string[], empfaengerZeilen: string[], datum: string,
 *   offenCent: number, zinsenCent: number, pauschaleCent: number, summeCent: number,
 *   verzugsbeginn: {datum: string|null, quelle: string|null},
 * }}
 */
export function mahnTextFelder(rechnung, stufe, ctx, t) {
  const { verzugsbeginn: verzug, offenCent, zinsen, pauschaleCent } = forderungAm(rechnung, ctx.vertrag, ctx.heute);
  const summeCent = offenCent + zinsen.cent + pauschaleCent;
  const mitPauschale = pauschaleCent > 0;

  const nummer = rechnung?.nummer || "";
  const rechnungsdatum = tagFuerBrief(rechnung?.rechnungsdatum);
  const offenText = formatEuro(offenCent);
  const zinsenText = formatEuro(zinsen.cent);
  const pauschaleText = formatEuro(pauschaleCent);
  const summeText = formatEuro(summeCent);
  const stufeDef = (ctx.einst?.mahnstufen || BUERO_STANDARD.mahnstufen).find((s) => s.stufe === stufe);
  const fristIso = ctx.frist || faelligeMahnstufe(rechnung, ctx.heute, ctx.einst?.mahnstufen)?.frist
    || /** @type {string} */ (plusTage(ctx.heute, stufeDef?.frist_tage ?? 7));
  const fristText = tagFuerBrief(fristIso);

  const betreff = stufe === 1 ? t("Zahlungserinnerung") : stufe === 2 ? t("Mahnung") : t("Letzte Mahnung");
  const anrede = t("Sehr geehrte Damen und Herren,");

  const zinshinweis = mitPauschale
    ? t("Der offene Betrag beträgt inzwischen {summe} (Rechnungsbetrag {offen} zzgl. Verzugszinsen {zinsen} und einer Pauschale von {pauschale} nach § 288 Abs. 5 BGB).")
      .replace("{summe}", summeText).replace("{offen}", offenText).replace("{zinsen}", zinsenText).replace("{pauschale}", pauschaleText)
    : t("Der offene Betrag beträgt inzwischen {summe} (Rechnungsbetrag {offen} zzgl. Verzugszinsen {zinsen}).")
      .replace("{summe}", summeText).replace("{offen}", offenText).replace("{zinsen}", zinsenText);

  /** @type {string[]} */
  let absaetze;
  if (stufe === 1) {
    absaetze = [
      t("Für die Rechnung {nummer} vom {datum} ist noch ein Betrag von {betrag} offen.")
        .replace("{nummer}", nummer).replace("{datum}", rechnungsdatum).replace("{betrag}", offenText),
      t("Möglicherweise haben Sie die Zahlung bereits veranlasst — in diesem Fall betrachten Sie dieses Schreiben bitte als gegenstandslos."),
      t("Wir bitten Sie, den offenen Betrag bis zum {frist} auszugleichen.").replace("{frist}", fristText),
    ];
  } else if (stufe === 2) {
    absaetze = [
      t("Trotz unserer Zahlungserinnerung ist die Rechnung {nummer} vom {datum} weiterhin nicht ausgeglichen.")
        .replace("{nummer}", nummer).replace("{datum}", rechnungsdatum),
      zinshinweis,
      t("Wir bitten Sie, den Betrag bis spätestens {frist} zu begleichen.").replace("{frist}", fristText),
    ];
  } else {
    absaetze = [
      t("Trotz mehrfacher Zahlungsaufforderung ist die Rechnung {nummer} vom {datum} weiterhin nicht beglichen.")
        .replace("{nummer}", nummer).replace("{datum}", rechnungsdatum),
      zinshinweis,
      t("Wir setzen Ihnen eine letzte Frist bis zum {frist}. Nach fruchtlosem Fristablauf behalten wir uns die Einleitung eines gerichtlichen Mahnverfahrens ohne weitere Ankündigung vor.")
        .replace("{frist}", fristText),
    ];
  }
  absaetze.push(t("Mit freundlichen Grüßen"));

  /** @type {string[][]} */
  const tabellenZeilen = [[t("Offener Betrag"), offenText]];
  if (zinsen.cent > 0) tabellenZeilen.push([t("Verzugszinsen bis {datum}").replace("{datum}", tagFuerBrief(ctx.heute)), zinsenText]);
  if (mitPauschale) tabellenZeilen.push([t("Pauschale"), pauschaleText]);
  tabellenZeilen.push([t("Summe"), summeText]);

  const empfaenger = rechnung?.empfaenger || {};
  const empfaengerZeilen = [empfaenger.name, ...String(empfaenger.anschrift || "").split("\n").map((z) => z.trim())].filter(Boolean);

  return {
    betreff,
    anrede,
    absaetze,
    tabelle: { kopf: [], zeilen: tabellenZeilen },
    absenderZeilen: briefkopfZeilen(ctx.briefkopf),
    empfaengerZeilen,
    datum: tagFuerBrief(ctx.heute),
    offenCent,
    zinsenCent: zinsen.cent,
    pauschaleCent,
    summeCent,
    verzugsbeginn: verzug,
  };
}

/**
 * Export table of the dunning list. `zeilen` are the SAME rows the section
 * shows (built from forderungAm()/faelligeMahnstufe() in
 * MahnwesenAbschnitt.jsx) — screen and export share one source.
 * @param {Array<{
 *   rechnung: Record<string, any>, tageUeberFaellig: number|null, offenCent: number,
 *   letzteStufe: {stufe: number, datum: string}|null, faelligeStufe: {stufe: number, ab: string}|null,
 *   zinsenCent: number, pauschaleCent: number,
 * }>} zeilen
 * @param {(schluessel: string) => string} t
 * @returns {import("./tabellenExport.js").Tabellenmodell}
 */
export function mahnTabelle(zeilen, t) {
  const rows = (zeilen || []).map((z) => ({
    nummer: z.rechnung?.nummer || "",
    projekt: z.rechnung?.project_name || "",
    empfaenger: z.rechnung?.empfaenger?.name || "",
    tage_ueberfaellig: z.tageUeberFaellig ?? 0,
    offen: centZuEuro(z.offenCent),
    stufe: z.letzteStufe?.stufe ?? 0,
    zinsen: centZuEuro(z.zinsenCent),
    pauschale: centZuEuro(z.pauschaleCent),
    summe: centZuEuro(z.offenCent + z.zinsenCent + z.pauschaleCent),
  }));
  return {
    titel: t("Mahnwesen"),
    spalten: [
      { key: "nummer", label: t("Nummer"), typ: "text" },
      { key: "projekt", label: t("Projekt"), typ: "text" },
      { key: "empfaenger", label: t("Empfänger"), typ: "text" },
      { key: "tage_ueberfaellig", label: t("Tage über Fälligkeit"), typ: "zahl" },
      { key: "offen", label: t("Offener Betrag"), typ: "betrag" },
      { key: "stufe", label: t("Mahnstufe"), typ: "zahl" },
      { key: "zinsen", label: t("Zinsen bis heute"), typ: "betrag" },
      { key: "pauschale", label: t("Pauschale"), typ: "betrag" },
      { key: "summe", label: t("Summe"), typ: "betrag" },
    ],
    zeilen: rows,
  };
}
