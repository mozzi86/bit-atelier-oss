// Fixed-asset register: method suggestion, yearly depreciation and book value
// per asset, plus the takeover from the fleet and the activation from an
// incoming invoice (phase 79, plan 79-09, BUCH-13).
//
// Four depreciation methods (GESETZ.AFA, einstellungen.js):
// - "sofort": net cost at or below AFA.sofort_grenze (250 €) — no register
//   needed by law, but this app still lists it (§ 6 Abs. 2 S. 4 EStG).
// - "gwg": net cost at or below AFA.gwg_grenze (800 €) — full write-off in the
//   year of acquisition (§ 6 Abs. 2 EStG).
// - "sammel": a pool item (net cost > 250 up to 1.000 €, § 6 Abs. 2a EStG) —
//   this is a yearly ELECTION covering every qualifying asset of that year,
//   not a per-item default, so methodeVorschlag() never suggests it on its
//   own; the form still allows a person to choose it for an asset in that
//   price band.
// - "linear": straight line, monthly pro rata in the year of acquisition
//   (§ 7 Abs. 1 S. 4 EStG, grundlagen.afaLinearCent).
//
// Disposal ("Abgang"): grundlagen.afaLinearCent's own `abgang` argument only
// STOPS the cumulative total from growing past the disposal month — it does
// not expense the rest of the book value. This module's own afaJahr() adds
// that last step itself (see afaJahr's "linear" branch), because the
// contract here is stronger: the sum of AfA over the asset's life must equal
// its acquisition cost exactly, and the remaining book value at the start of
// the disposal year is expensed THAT year (whatever is left after the
// elapsed months' normal depreciation).
//
// In:  Anlagegut/Fahrzeug/Eingangsrechnung records (datenmodell.js, amounts
//      in EURO), `saetze` (einstellungen.saetzeZum, GESETZ.AFA resolved for a
//      reference date).
// Out: pure functions in CENTS (geld.js convention), plus literal t() text
//      helpers for the category/method enums (pattern of fuhrpark.js
//      antriebText/methodeText).

import { jahrVon } from "@core/lib/kalender/datum.js";
import { centZuEuro, euroZuCent } from "./geld.js";
import { afaLinearCent } from "./grundlagen.js";

/**
 * New record id, generated here (not imported from speicher.js, which keeps
 * its generator private): T2's activation flow needs the Anlagegut's id
 * BEFORE writing, to put the very same id into the Eingangsrechnung's
 * `anlage_id` within one write batch. Same shape as the rest of the app's ids
 * (timestamp base36 + random chars) so it is not visibly different in the UI.
 * @returns {string}
 */
function neueAnlageId() {
  return `ag-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Suggested depreciation method by net acquisition cost. Never suggests
 * "sammel" (see module header) — a value above the GWG limit is suggested as
 * "linear", even though "sammel" stays a choosable method for that price band
 * in the form.
 * @param {number} akNettoCent net acquisition cost, cents
 * @param {{afa?: {sofort_grenze?: number, gwg_grenze?: number}}} saetze einstellungen.saetzeZum(stichtag)
 * @returns {"sofort"|"gwg"|"linear"}
 */
export function methodeVorschlag(akNettoCent, saetze) {
  const sofortCent = euroZuCent(saetze?.afa?.sofort_grenze);
  const gwgCent = euroZuCent(saetze?.afa?.gwg_grenze);
  if (akNettoCent <= sofortCent) return "sofort";
  if (akNettoCent <= gwgCent) return "gwg";
  return "linear";
}

/**
 * Suggested useful life by asset category, from GESETZ.AFA.nd_tabelle.
 * @param {string} kategorie bueroausstattung|rechner|plotter|fahrzeug|software|sonstiges
 * @param {{afa?: {nd_tabelle?: Record<string, number>}}} saetze
 * @returns {number|null} years, or null when the category is not in the table
 */
export function nutzungsdauerVorschlag(kategorie, saetze) {
  const wert = saetze?.afa?.nd_tabelle?.[kategorie];
  return Number.isFinite(wert) ? wert : null;
}

/**
 * Cumulative straight-line depreciation through the end of `jahr`, as if the
 * asset were never disposed. grundlagen.afaLinearCent only returns one year's
 * delta, so this sums the deltas from the acquisition year to `jahr` — reuses
 * the tested month arithmetic instead of re-deriving it.
 * @param {number} akCent cents
 * @param {number} ndJahre years
 * @param {string} anschaffung 'YYYY-MM-DD'
 * @param {number} jahr business year
 * @returns {number} cents
 */
function kumuliertLinear(akCent, ndJahre, anschaffung, jahr) {
  const startJahr = jahrVon(anschaffung);
  if (!Number.isFinite(startJahr) || jahr < startJahr) return 0;
  let summe = 0;
  for (let y = startJahr; y <= jahr; y++) summe += afaLinearCent(akCent, ndJahre, anschaffung, y, null);
  return summe;
}

/**
 * One asset's depreciation for one business year, under ITS OWN `methode`.
 * - "sofort"/"gwg": the full net cost in the acquisition year, 0 afterwards
 *   (nothing left to write off, a later disposal has no further effect here).
 * - "sammel": a flat 1/jahre share of the net cost per year, for `jahre`
 *   years from the acquisition year, whole years only (no pro rata) — a
 *   disposal of the individual item does not change the pool (matches how
 *   § 6 Abs. 2a EStG treats the pool as a whole, not its individual items).
 * - "linear": grundlagen.afaLinearCent's normal monthly pro rata, EXCEPT in
 *   the disposal year itself, where the entire book value remaining at the
 *   start of that year is expensed (elapsed months' depreciation plus the
 *   residual "Restbuchwert" in one figure — see module header); 0 in every
 *   year after the disposal year.
 * @param {{ak_netto?: number, nutzungsdauer?: number, anschaffung_datum?: string,
 *   methode?: string, abgang?: {datum?: string}|null}} anlage
 * @param {number|string} jahr business year
 * @param {{afa?: {sammelposten?: {jahre?: number}}}} saetze
 * @returns {number} cents, never negative
 */
export function afaJahr(anlage, jahr, saetze) {
  const akCent = euroZuCent(anlage?.ak_netto);
  const jahrZahl = Number(jahr);
  const anschaffungJahr = jahrVon(anlage?.anschaffung_datum);
  if (!Number.isFinite(anschaffungJahr) || jahrZahl < anschaffungJahr) return 0;
  const abgangJahr = anlage?.abgang?.datum ? jahrVon(anlage.abgang.datum) : null;

  if (anlage?.methode === "sofort" || anlage?.methode === "gwg") {
    return jahrZahl === anschaffungJahr ? akCent : 0;
  }

  if (anlage?.methode === "sammel") {
    const jahre = Number(saetze?.afa?.sammelposten?.jahre) || 5;
    const idx = jahrZahl - anschaffungJahr;
    if (idx < 0 || idx >= jahre) return 0;
    const proJahrCent = Math.floor(akCent / jahre);
    const rest = akCent - proJahrCent * jahre;
    return idx === jahre - 1 ? proJahrCent + rest : proJahrCent; // last year absorbs the rounding remainder
  }

  // "linear" (default/fallback for a missing or unknown methode). A bad
  // nutzungsdauer (0, negative, missing) is NOT defaulted away here — it
  // reaches afaLinearCent's own validation and throws, same as every other
  // malformed field; the caller (anlagenverzeichnis) is what drops such a
  // record instead of letting it break the whole register.
  const ndJahre = Number(anlage?.nutzungsdauer);
  if (abgangJahr !== null) {
    if (jahrZahl > abgangJahr) return 0;
    if (jahrZahl === abgangJahr) {
      const kumuliertVorher = kumuliertLinear(akCent, ndJahre, anlage.anschaffung_datum, jahrZahl - 1);
      return Math.max(0, akCent - kumuliertVorher);
    }
  }
  return afaLinearCent(akCent, ndJahre, anlage.anschaffung_datum, jahrZahl, null);
}

/**
 * Book value at the end of the year of `stichtag` (nie negativ — never
 * negative), by summing afaJahr() from the acquisition year up to that year.
 * A disposed asset's book value is 0 from its disposal year onward (afaJahr's
 * "linear" branch already expenses the remainder that year).
 * @param {Parameters<typeof afaJahr>[0]} anlage
 * @param {string} stichtag 'YYYY-MM-DD' (the Reiter always passes 31.12. of the shown year)
 * @param {Parameters<typeof afaJahr>[2]} saetze
 * @returns {number} cents
 */
export function restbuchwert(anlage, stichtag, saetze) {
  const akCent = euroZuCent(anlage?.ak_netto);
  const jahr = jahrVon(stichtag);
  const anschaffungJahr = jahrVon(anlage?.anschaffung_datum);
  if (!Number.isFinite(jahr) || !Number.isFinite(anschaffungJahr) || jahr < anschaffungJahr) return akCent;
  let kumuliert = 0;
  for (let y = anschaffungJahr; y <= jahr; y++) kumuliert += afaJahr(anlage, y, saetze);
  return Math.max(0, akCent - kumuliert);
}

/**
 * The register for one business year: every Anlagegut with its computed
 * depreciation and book value. A malformed record (bad date/ND) is skipped
 * rather than breaking the whole list — pattern of fuhrpark.js fahrzeugKosten.
 * @param {{Anlagegut?: Array<Record<string, any>>}} daten bh.daten
 * @param {number|string} jahr business year
 * @param {Parameters<typeof afaJahr>[2]} saetze
 * @returns {Array<Record<string, any> & {afaJahrCent: number, restbuchwertCent: number}>}
 */
export function anlagenverzeichnis(daten, jahr, saetze) {
  const liste = Array.isArray(daten?.Anlagegut) ? daten.Anlagegut : [];
  const jahrZahl = Number(jahr);
  return liste.flatMap((a) => {
    try {
      return [{
        ...a,
        afaJahrCent: afaJahr(a, jahrZahl, saetze),
        restbuchwertCent: restbuchwert(a, `${jahrZahl}-12-31`, saetze),
      }];
    } catch {
      return []; // malformed asset record — do not let one bad row break the register
    }
  });
}

/**
 * Sum of one business year's depreciation over the whole register — the
 * figure the EÜR (79-11) adds as a business expense.
 * @param {Parameters<typeof anlagenverzeichnis>[0]} daten bh.daten
 * @param {number|string} jahr business year
 * @param {Parameters<typeof afaJahr>[2]} saetze
 * @returns {number} cents
 */
export function afaSumme(daten, jahr, saetze) {
  return anlagenverzeichnis(daten, jahr, saetze).reduce((n, a) => n + a.afaJahrCent, 0);
}

/**
 * Purchased fleet vehicles (Fahrzeug.kauf_leasing === "kauf") that have no
 * Anlagegut yet linking to them — candidates the "Fahrzeuge übernehmen" card
 * offers. A vehicle disappears from this list once it has been taken over.
 * @param {{Fahrzeug?: Array<Record<string, any>>, Anlagegut?: Array<Record<string, any>>}} daten bh.daten
 * @returns {Array<Record<string, any>>}
 */
export function fahrzeugKandidaten(daten) {
  const fahrzeuge = Array.isArray(daten?.Fahrzeug) ? daten.Fahrzeug : [];
  const anlagen = Array.isArray(daten?.Anlagegut) ? daten.Anlagegut : [];
  const belegt = new Set(anlagen.map((a) => a?.fahrzeug_id).filter(Boolean));
  return fahrzeuge.filter((f) => f?.kauf_leasing === "kauf" && !belegt.has(f?.id));
}

/**
 * Fixed-asset draft for a purchased fleet vehicle. `ak_netto` comes from the
 * matching incoming invoice's net amount when one is given — NEVER from the
 * vehicle's list price (Bruttolistenpreis, a tax-assessment figure, not an
 * acquisition cost) — otherwise it is left empty for the person to enter.
 * A leased vehicle is refused outright: a lease is never activated as a
 * fixed asset (its rate is an ongoing expense, booked as an Eingangsrechnung).
 * @param {{id?: string, kennzeichen?: string, anschaffung_datum?: string, kauf_leasing?: string}} fahrzeug
 * @param {{netto?: number}|null} [eingangsrechnung] the vehicle's purchase invoice, if on file
 * @returns {{bezeichnung: string, kategorie: "fahrzeug", ak_netto: number|"", nutzungsdauer: number,
 *   anschaffung_datum: string, methode: "linear", fahrzeug_id: string, abgang: null}}
 * @throws {Error} when the vehicle is leased
 */
export function fahrzeugUebernehmen(fahrzeug, eingangsrechnung = null) {
  if (fahrzeug?.kauf_leasing === "leasing") throw new Error("Leasingfahrzeuge werden nicht aktiviert.");
  return {
    bezeichnung: fahrzeug?.kennzeichen ? `Fahrzeug ${fahrzeug.kennzeichen}` : "Fahrzeug",
    kategorie: "fahrzeug",
    ak_netto: typeof eingangsrechnung?.netto === "number" ? eingangsrechnung.netto : "",
    nutzungsdauer: 6,
    anschaffung_datum: fahrzeug?.anschaffung_datum,
    methode: "linear",
    fahrzeug_id: fahrzeug?.id,
    abgang: null,
  };
}

// Eingangsrechnung.kategorie values that map onto an Anlagegut.kategorie of
// the same meaning; everything else defaults to "sonstiges".
const RECHNUNG_KATEGORIE_ANLAGE = Object.freeze({ software: "software", fahrzeug: "fahrzeug" });

/**
 * Activates an incoming invoice as a fixed asset: a draft Anlagegut plus the
 * two writes to persist it (Anlagegut anlegen, `anlage_id` an der
 * Eingangsrechnung setzen, damit die EÜR AfA statt Ausgabe zählt — 79-01's
 * data contract). The Anlagegut's id is generated here (see neueAnlageId)
 * so both writes can share it. `methode`/`nutzungsdauer` are left for the
 * person to set on the newly created record (via "Bearbeiten") — this pure
 * function does not receive `saetze`/`t`, so it cannot look up their
 * suggested values itself; the caller (AnlagenReiter) merges those in before
 * writing, using bh.saetze.
 * @param {Record<string, any>} eingangsrechnung an Eingangsrechnung without anlage_id (id, lieferant?,
 *   kategorie?, netto, rechnungsdatum?, leistungsdatum?)
 * @returns {{entwurf: Record<string, any>, schreibliste: Array<{entitaet: string, obj: Record<string, any>}>}}
 */
export function ausEingangsrechnung(eingangsrechnung) {
  const anlageId = neueAnlageId();
  const entwurf = {
    id: anlageId,
    bezeichnung: eingangsrechnung?.lieferant || "",
    kategorie: RECHNUNG_KATEGORIE_ANLAGE[eingangsrechnung?.kategorie || ""] || "sonstiges",
    ak_netto: eingangsrechnung?.netto,
    anschaffung_datum: eingangsrechnung?.rechnungsdatum || eingangsrechnung?.leistungsdatum,
    eingangsrechnung_id: eingangsrechnung?.id,
    abgang: null,
  };
  const schreibliste = [
    { entitaet: "Anlagegut", obj: entwurf },
    { entitaet: "Eingangsrechnung", obj: { id: eingangsrechnung?.id, anlage_id: anlageId } },
  ];
  return { entwurf, schreibliste };
}

/**
 * Table model of the register for CSV/XLSX export (ExportKnopf). `saetze` is
 * needed to compute the AfA/Restbuchwert columns and is not part of the
 * plan's literal 3-argument signature — same deviation as fuhrpark.js
 * fuhrparkTabelle in 79-08, for the same reason (no Euro value without it).
 * @param {Parameters<typeof anlagenverzeichnis>[0]} daten bh.daten
 * @param {number|string} jahr business year
 * @param {(schluessel: string) => string} t translator (column labels, enum text)
 * @param {Parameters<typeof afaJahr>[2]} saetze
 * @returns {import("./tabellenExport.js").Tabellenmodell}
 */
export function anlagenTabelle(daten, jahr, t, saetze) {
  const zeilen = anlagenverzeichnis(daten, jahr, saetze);
  return {
    titel: t("Anlagenverzeichnis"),
    spalten: [
      { key: "bezeichnung", label: t("Bezeichnung"), typ: "text" },
      { key: "kategorie", label: t("Kategorie"), typ: "text" },
      { key: "anschaffung", label: t("Anschaffungsdatum"), typ: "datum" },
      { key: "ak_netto", label: t("AK netto"), typ: "betrag" },
      { key: "nutzungsdauer", label: t("Nutzungsdauer (Jahre)"), typ: "text" },
      { key: "methode", label: t("Methode"), typ: "text" },
      { key: "afa", label: t("AfA im Jahr"), typ: "betrag" },
      { key: "restbuchwert", label: t("Restbuchwert"), typ: "betrag" },
    ],
    zeilen: zeilen.map((a) => ({
      bezeichnung: a.bezeichnung || "", kategorie: kategorieText(a.kategorie, t),
      anschaffung: a.anschaffung_datum || "", ak_netto: a.ak_netto || 0, nutzungsdauer: a.nutzungsdauer ?? "",
      methode: methodeText(a.methode, t), afa: centZuEuro(a.afaJahrCent), restbuchwert: centZuEuro(a.restbuchwertCent),
    })),
  };
}

/** @param {string} kategorie @param {(k: string) => string} t */
export function kategorieText(kategorie, t) {
  switch (kategorie) {
    case "bueroausstattung": return t("Büroausstattung");
    case "rechner": return t("Rechner");
    case "plotter": return t("Plotter");
    case "fahrzeug": return t("Fahrzeug");
    case "software": return t("Software");
    default: return t("Sonstiges");
  }
}

/** @param {string} methode @param {(k: string) => string} t */
export function methodeText(methode, t) {
  switch (methode) {
    case "sofort": return t("Sofortabzug");
    case "gwg": return t("GWG");
    case "sammel": return t("Sammelposten");
    default: return t("Linear");
  }
}
