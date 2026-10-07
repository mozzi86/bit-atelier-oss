// Bank CSV import of the accounting module (79-07, BUCH-11): parses a bank's
// account-statement export into plain transaction records, whatever dialect
// the bank uses — separator, preamble rows before the real header, decimal
// point vs. comma, one signed amount column vs. Soll/Haben. Everything here is
// index-driven (RESEARCH "Bank-CSV-Formate"): a profile names the COLUMN INDEX
// of every field it needs, never the column NAME — real exports repeat a
// column name (ING's "Währung" twice) or omit one the researcher expected.
//
// Amount parsing is profile-controlled (`zahlformat`), deliberately NOT the
// heuristic "has both '.' and ','? guess which is the decimal point" of
// gaebXmlRead.menge() (packages/nova-ausschreibung/src/lib/gaebXmlRead.js:119)
// — a bank amount is money, guessing wrong here would misfile a payment.
//
// In:  the uploaded file's raw bytes (never `file.text()` — csv.js/dekodiere
//      is the only decoder, so CP1252 exports such as Sparkasse/ING survive)
//      and either a BANK_PROFILE key or a custom mapping from SpaltenZuordnung.
// Out: `Bankumsatz`-shaped plain objects (buchungstag/valuta/betrag/zweck/
//      gegenpartei/iban), Euro amounts (not cents) to match the data contract.

import { dekodiere, parseCsv } from "./csv.js";
import { centZuEuro, euroZuCent, parseBetragDe } from "./geld.js";
import { parseTag } from "@core/lib/kalender/datum.js";

/**
 * One bank export dialect. `spalten` values are 0-based column indices (or an
 * array of indices tried in order, first non-empty wins — DKB has separate
 * payer/payee columns) into the row AFTER `findeKopfzeile` has skipped the
 * preamble. `betrag` is either one index (signed amount), or `{sh: index}`
 * paired with a Soll/Haben indicator column, or `{soll, haben}` for banks that
 * use two separate unsigned amount columns (Postbank/Deutsche Bank).
 * `zeichensatz` is informational only (shown in the UI, kept on a saved custom
 * profile) — the actual bytes always go through csv.js `dekodiere`, which
 * already falls back from UTF-8 to windows-1252 on its own.
 * @typedef {{
 *   label: string, trenner: string, zahlformat: "de"|"en",
 *   datumsformat: "tt.mm.jjjj"|"tt.mm.jj"|"jjjj-mm-tt", zeichensatz: string,
 *   spalten: {
 *     datum: number|number[], valuta?: number|number[],
 *     betrag?: number|number[], sh?: number, betrag_soll_haben?: {soll: number, haben: number},
 *     zweck?: number|number[], gegenpartei?: number|number[], iban?: number|number[],
 *   },
 *   kopfErkennung?: string[],
 * }} BankProfil
 */

/** Known German bank CSV dialects, keyed by profile id, plus "generisch" as the manual-mapping starting template. */
export const BANK_PROFILE = Object.freeze({
  "sparkasse-camt-v2": {
    label: "Sparkasse (CSV-CAMT V2)",
    trenner: ";", zahlformat: "de", datumsformat: "tt.mm.jj", zeichensatz: "windows-1252",
    spalten: { datum: 1, valuta: 2, betrag: 14, zweck: 4, gegenpartei: 11, iban: 12 },
    kopfErkennung: ["Auftragskonto", "Buchungstag", "Valutadatum", "Verwendungszweck", "Beguenstigter/Zahlungspflichtiger", "Kontonummer/IBAN", "Betrag"],
  },
  "vr-gls-sparda": {
    label: "VR-Bank / Sparda / GLS",
    trenner: ";", zahlformat: "de", datumsformat: "tt.mm.jjjj", zeichensatz: "utf-8",
    spalten: { datum: 4, valuta: 5, betrag: 11, zweck: 10, gegenpartei: 6, iban: 7 },
    kopfErkennung: ["Name Zahlungsbeteiligter", "IBAN Zahlungsbeteiligter", "Saldo nach Buchung", "Buchungstag", "Betrag"],
  },
  "vr-alt": {
    label: "VR-Bank (alt, Soll/Haben)",
    trenner: ";", zahlformat: "de", datumsformat: "tt.mm.jjjj", zeichensatz: "utf-8",
    spalten: { datum: 0, valuta: 1, betrag: 6, sh: 7, zweck: 3, gegenpartei: 4, iban: 5 },
    kopfErkennung: ["Buchungstag", "Valutadatum", "Beguenstigter/Zahlungspflichtiger", "Kontonummer/IBAN", "Betrag", "Soll/Haben"],
  },
  dkb: {
    label: "DKB (neu)",
    trenner: ";", zahlformat: "de", datumsformat: "tt.mm.jjjj", zeichensatz: "utf-8",
    spalten: { datum: 0, valuta: 1, betrag: 8, zweck: 5, gegenpartei: [4, 3], iban: 7 },
    kopfErkennung: ["Buchungsdatum", "Wertstellung", "Zahlungsempfänger*in", "Umsatztyp", "IBAN", "Betrag (€)"],
  },
  ing: {
    label: "ING",
    trenner: ";", zahlformat: "de", datumsformat: "tt.mm.jjjj", zeichensatz: "windows-1252",
    // ING repeats the column name "Währung" (index 6 and 8) — the profile
    // still finds the amount by its fixed index 7, unaffected by the name clash.
    spalten: { datum: 0, valuta: 1, betrag: 7, zweck: 4, gegenpartei: 2 },
    kopfErkennung: ["Buchungstag", "Valutadatum", "Auftraggeber/Empfänger", "Saldo", "Betrag"],
  },
  commerzbank: {
    label: "Commerzbank",
    trenner: ";", zahlformat: "de", datumsformat: "tt.mm.jjjj", zeichensatz: "utf-8",
    spalten: { datum: 0, valuta: 1, betrag: 4, zweck: 3, gegenpartei: 7, iban: 6 },
    kopfErkennung: ["Buchungstag", "Wertstellung", "Umsatzart", "Betrag", "IBAN", "Auftraggeber/Empfänger"],
  },
  "postbank-deutschebank": {
    label: "Postbank / Deutsche Bank",
    trenner: ";", zahlformat: "de", datumsformat: "tt.mm.jjjj", zeichensatz: "utf-8",
    spalten: { datum: 0, valuta: 1, betrag_soll_haben: { soll: 8, haben: 9 }, zweck: 4, gegenpartei: 7, iban: 6 },
    kopfErkennung: ["Buchungstag", "Valuta", "Vorgang", "Auftraggeberkonto", "Betrag Soll", "Betrag Haben"],
  },
  n26: {
    label: "N26 / Finom / Vivid",
    trenner: ",", zahlformat: "en", datumsformat: "jjjj-mm-tt", zeichensatz: "utf-8",
    spalten: { datum: 0, valuta: 0, betrag: 6, zweck: 4, gegenpartei: 1, iban: 2 },
    kopfErkennung: ["Datum", "Empfänger", "Transaktionstyp", "Betrag (EUR)", "Fremdwährung"],
  },
  generisch: {
    label: "Generisch (manuelle Zuordnung)",
    trenner: ";", zahlformat: "de", datumsformat: "tt.mm.jjjj", zeichensatz: "utf-8",
    spalten: {},
  },
});

/**
 * Index of the first line that looks like the real header — some banks (DKB,
 * ING) put account info and blank lines before it. Recognised by a "Buchungs-
 * tag"/"Buchungsdatum"/"Datum" column together with a "Betrag" column on the
 * SAME raw line (case-insensitive substring, so it survives whatever exact
 * column name a bank chose around it).
 * @param {string[]} zeilen raw text lines (not yet split into fields)
 * @returns {number} index into `zeilen`, or -1 when no such line exists
 */
export function findeKopfzeile(zeilen) {
  const KEY_DATUM = /datum|buchungstag/i;
  const KEY_BETRAG = /betrag/i;
  for (let i = 0; i < (zeilen || []).length; i++) {
    if (KEY_DATUM.test(zeilen[i]) && KEY_BETRAG.test(zeilen[i])) return i;
  }
  return -1;
}

/** @param {string} s @returns {string} trimmed, BOM and case removed, for header-field comparison */
function normFeld(s) {
  const ohneBom = s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : String(s ?? "");
  return ohneBom.trim().toLowerCase();
}

/**
 * Identifies a known bank profile from the raw header line, by trying EACH
 * profile's own separator on that same line and checking whether every one of
 * its `kopfErkennung` column names then turns up (exact match, case-
 * insensitive) — the wrong separator mashes the line into the wrong fields and
 * naturally fails this check, so no separator has to be guessed up front.
 * @param {string} kopf the raw header line (not yet split)
 * @returns {string|null} a BANK_PROFILE key, or null when none matches
 */
export function erkenneProfil(kopf) {
  const zeile = String(kopf ?? "");
  let treffer = null;
  let bestesMass = 0;
  for (const [name, profilRoh] of Object.entries(BANK_PROFILE)) {
    const profil = /** @type {BankProfil} */ (profilRoh);
    const erkennung = profil.kopfErkennung;
    if (name === "generisch" || !erkennung?.length) continue;
    const felder = (parseCsv(zeile, { trenner: profil.trenner })[0] || []).map(normFeld);
    const gefunden = erkennung.every((f) => felder.includes(normFeld(f)));
    if (gefunden && erkennung.length > bestesMass) { treffer = name; bestesMass = erkennung.length; }
  }
  return treffer;
}

/**
 * German ("1.234,56", "-12,5") or English ("1,234.56") amount text → cents.
 * "de" delegates to geld.js `parseBetragDe` (thousands dot, decimal comma —
 * the same parser the rest of the accounting module uses for typed amounts);
 * "en" is its mirror (thousands comma, decimal point), local to this module
 * since no other area needs it. Never guesses the format from the text itself
 * — the caller's profile says which one applies (not gaebXmlRead.menge()'s
 * heuristic of "has both '.' and ','? guess which is the decimal point").
 * @param {string} text
 * @param {"de"|"en"} zahlformat
 * @returns {number|null} whole cents, or null when the text is not an amount
 */
export function betragCent(text, zahlformat) {
  return zahlformat === "en" ? parseBetragEn(text) : parseBetragDe(text);
}

/** English amount text ("1,234.56", "-12.5", "(12.50)") → cents, or null. @param {unknown} text */
function parseBetragEn(text) {
  if (typeof text !== "string" && typeof text !== "number") return null;
  // \s already matches NBSP/narrow-NBSP (Unicode Zs space separators), no explicit \u00a0/\u202f needed.
  let s = String(text).replace(/[$€]/g, "").replace(/\s/g, "");
  if (!s) return null;
  let negativ = false;
  if (/^[(-]/.test(s)) { negativ = true; s = s.replace(/^[(-]/, "").replace(/\)$/, ""); }
  else if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(s)) return null;
  const ohneKomma = s.replace(/,/g, "");
  const [ganz, bruch = ""] = ohneKomma.split(".");
  const cent = Number(ganz) * 100 + Number((bruch + "00").slice(0, 2));
  return Number.isFinite(cent) ? (negativ ? -cent : cent) : null;
}

/**
 * Date text → 'YYYY-MM-DD'. `"tt.mm.jj"` treats a 2-digit year as 20xx
 * (Sparkasse CAMT V2); `"jjjj-mm-tt"` accepts an already-ISO date (N26). Real
 * calendar dates only (delegates to `@core/lib/kalender/datum.js` `parseTag`).
 * @param {string} text
 * @param {"tt.mm.jjjj"|"tt.mm.jj"|"jjjj-mm-tt"} datumsformat
 * @returns {string|null} 'YYYY-MM-DD', or null when unreadable
 */
export function datumIso(text, datumsformat) {
  const s = String(text ?? "").trim();
  if (!s) return null;
  if (datumsformat === "jjjj-mm-tt") return parseTag(s);
  const teile = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!teile) return null;
  const [, tt, mm, jj] = teile;
  if (datumsformat === "tt.mm.jj" && jj.length !== 2) return null;
  if (datumsformat === "tt.mm.jjjj" && jj.length !== 4) return null;
  const jahr = jj.length === 2 ? 2000 + Number(jj) : Number(jj);
  return parseTag(`${String(jahr).padStart(4, "0")}-${mm.padStart(2, "0")}-${tt.padStart(2, "0")}`);
}

/** First non-empty field among one or several column indices. @param {string[]} zeile @param {number|number[]|undefined} idx */
function feld(zeile, idx) {
  if (idx === undefined || idx === null) return "";
  for (const i of Array.isArray(idx) ? idx : [idx]) {
    const wert = (zeile[i] ?? "").trim();
    if (wert) return wert;
  }
  return "";
}

/**
 * One parsed CSV row → a transaction's cent amount, per the profile's amount
 * shape (one signed column, a column plus Soll/Haben indicator, or two
 * unsigned Soll/Haben columns).
 * @param {string[]} zeile @param {BankProfil} profil
 * @returns {number|null} cents, or null when unreadable
 */
function betragAusZeile(zeile, profil) {
  const s = profil.spalten;
  if (s.betrag_soll_haben) {
    const soll = feld(zeile, s.betrag_soll_haben.soll);
    const haben = feld(zeile, s.betrag_soll_haben.haben);
    if (soll) { const c = betragCent(soll, profil.zahlformat); return c === null ? null : -Math.abs(c); }
    if (haben) { const c = betragCent(haben, profil.zahlformat); return c === null ? null : Math.abs(c); }
    return null;
  }
  const roh = betragCent(feld(zeile, s.betrag), profil.zahlformat);
  if (roh === null) return null;
  if (s.sh !== undefined) {
    const zeichen = feld(zeile, s.sh).toUpperCase().startsWith("S") ? -1 : 1;
    return zeichen * Math.abs(roh);
  }
  return roh;
}

/**
 * One parsed CSV row (fields already split by the profile's separator) → a
 * transaction, Euro amount (not cents, to match the Bankumsatz data contract).
 * @param {string[]} zeile @param {BankProfil} profil
 * @returns {{buchungstag: string|null, valuta: string|null, betrag: number|null, zweck: string, gegenpartei: string, iban: string}}
 */
function zeileZuUmsatz(zeile, profil) {
  const s = profil.spalten;
  const buchungstag = datumIso(feld(zeile, s.datum), profil.datumsformat);
  const valutaText = feld(zeile, s.valuta);
  const cent = betragAusZeile(zeile, profil);
  return {
    buchungstag,
    valuta: valutaText ? datumIso(valutaText, profil.datumsformat) : buchungstag,
    betrag: cent === null ? null : centZuEuro(cent),
    zweck: feld(zeile, s.zweck),
    gegenpartei: feld(zeile, s.gegenpartei),
    iban: feld(zeile, s.iban),
  };
}

/**
 * Parses an uploaded bank export into transactions.
 * @param {Uint8Array|ArrayBuffer} bytes the file's raw bytes (never `file.text()`)
 * @param {string|BankProfil} profilOderZuordnung a BANK_PROFILE key, or a custom
 *   mapping (from SpaltenZuordnung.jsx / `eigenesProfil`) shaped like BankProfil
 * @returns {Array<{buchungstag: string, valuta: string, betrag: number, zweck: string, gegenpartei: string, iban: string}>}
 * @throws {Error} plain text when no header line is found, or a data row's date/amount cannot be read
 */
export function umsaetzeAus(bytes, profilOderZuordnung) {
  const profil = typeof profilOderZuordnung === "string" ? BANK_PROFILE[profilOderZuordnung] : profilOderZuordnung;
  if (!profil) throw new Error(`Bank-Import: unbekanntes Profil „${profilOderZuordnung}”.`);
  const text = dekodiere(bytes);
  const rohZeilen = text.split(/\r?\n/);
  const kopfIndex = findeKopfzeile(rohZeilen);
  if (kopfIndex < 0) throw new Error("Bank-Import: keine Kopfzeile mit Buchungstag/-datum und Betrag gefunden.");
  const rest = rohZeilen.slice(kopfIndex).join("\n");
  const zeilen = parseCsv(rest, { trenner: profil.trenner || ";" });
  const datenzeilen = zeilen.slice(1).filter((z) => z.some((f) => f !== ""));
  return datenzeilen.map((zeile, i) => {
    const umsatz = zeileZuUmsatz(zeile, profil);
    if (!umsatz.buchungstag || umsatz.betrag === null) {
      throw new Error(`Bank-Import: Zeile ${i + 2} unlesbar (Datum oder Betrag „${zeile.join(profil.trenner || ";")}”).`);
    }
    return /** @type {{buchungstag: string, valuta: string, betrag: number, zweck: string, gegenpartei: string, iban: string}} */ (umsatz);
  });
}

/**
 * A manual SpaltenZuordnung mapping as a BankProfil, ready for `umsaetzeAus`
 * and for storing in `einst.bank_profile[]` (survives a tab switch — it is
 * settings, not component state).
 * @param {{name: string, trenner?: string, zahlformat?: "de"|"en",
 *   datumsformat?: "tt.mm.jjjj"|"tt.mm.jj"|"jjjj-mm-tt", zeichensatz?: string,
 *   spalten: BankProfil["spalten"]}} zuordnung
 * @returns {BankProfil & {name: string}}
 */
export function eigenesProfil(zuordnung) {
  return {
    label: zuordnung.name || "Eigenes Profil",
    name: zuordnung.name || "Eigenes Profil",
    trenner: zuordnung.trenner || ";",
    zahlformat: zuordnung.zahlformat === "en" ? "en" : "de",
    datumsformat: zuordnung.datumsformat || "tt.mm.jjjj",
    zeichensatz: zuordnung.zeichensatz || "utf-8",
    spalten: { ...zuordnung.spalten },
  };
}

// --- Fingerprint and reimport dedup (T2) ------------------------------------
//
// A re-imported statement must not create duplicate Bankumsatz records, but a
// bank genuinely can book two identical-looking lines on the same day (two
// cash withdrawals of the same amount). The fingerprint is therefore built
// from the visible fields PLUS the occurrence index of that exact line within
// the file being imported — as long as a reimported file lists its rows in the
// same order (true for every export a bank regenerates for the same period),
// the same line gets the same index, and so the same fingerprint, again.

/**
 * Purpose text → comparable form for BOTH the fingerprint and general display:
 * runs of whitespace collapsed to one space, upper case.
 * @param {unknown} text
 * @returns {string}
 */
export function normZweck(text) {
  return String(text ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

/** @param {{buchungstag?: string, betrag?: number, zweck?: string, iban?: string}} umsatz @returns {string} everything but the occurrence index */
function basisSchluessel(umsatz) {
  const iban = String(umsatz?.iban ?? "").replace(/\s+/g, "").toUpperCase();
  return `${umsatz?.buchungstag}|${euroZuCent(umsatz?.betrag)}|${normZweck(umsatz?.zweck)}|${iban}`;
}

/**
 * Reimport fingerprint: booking day, amount in cents, normalised purpose,
 * IBAN, and `vorkommen` — the 0-based index of this exact line among identical
 * lines of the SAME file (0 for the first, 1 for the second, …), so that two
 * genuinely identical bookings on one day still get distinct fingerprints.
 * @param {{buchungstag?: string, betrag?: number, zweck?: string, iban?: string}} umsatz
 * @param {number} vorkommen
 * @returns {string}
 */
export function fingerabdruck(umsatz, vorkommen) {
  return `${basisSchluessel(umsatz)}|${vorkommen}`;
}

/**
 * Splits freshly parsed transactions into genuinely new ones and duplicates of
 * already-stored Bankumsatz records (matched by `hash`, which was computed the
 * same way on the earlier import). `neu` entries are Bankumsatz-shaped and
 * ready for bh.speichereViele (no `id` yet — the storage layer assigns one).
 * @param {Array<{hash?: string}>} bestehend already-stored Bankumsatz records (bh.daten.Bankumsatz)
 * @param {Array<{buchungstag: string, valuta: string, betrag: number, zweck: string, gegenpartei: string, iban: string}>} importiert `umsaetzeAus()`'s result, in file order
 * @param {string} importId groups this batch (`Bankumsatz.import_id`)
 * @returns {{neu: Array<Record<string, any>>, dubletten: Array<Record<string, any>>}}
 */
export function neueUmsaetze(bestehend, importiert, importId) {
  const bestehendeHashes = new Set((bestehend || []).map((b) => b.hash).filter(Boolean));
  const zaehler = new Map();
  const neu = [];
  const dubletten = [];
  for (const u of importiert || []) {
    const basis = basisSchluessel(u);
    const vorkommen = zaehler.get(basis) || 0;
    zaehler.set(basis, vorkommen + 1);
    const hash = fingerabdruck(u, vorkommen);
    if (bestehendeHashes.has(hash)) { dubletten.push(u); continue; }
    neu.push({
      buchungstag: u.buchungstag, valuta: u.valuta, betrag: u.betrag, zweck: u.zweck, gegenpartei: u.gegenpartei, iban: u.iban,
      import_id: importId, hash, status: "offen", zuordnung: null,
    });
  }
  return { neu, dubletten };
}
