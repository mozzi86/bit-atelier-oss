// priceReference.js — Los-Summen-Benchmark aus öffentlichen Vergabedaten (Phase 28).
//
// ZWECK: Zuschlagswerte aus TED (Tenders Electronic Daily, EU-Oberschwelle) und dem
// Datenservice Öffentlicher Einkauf (DÖE, Beschaffungsamt BMI) werden zu aggregierten
// Benchmark-Zellen CPV-Gruppe × Region (Bundesland) × Jahr verdichtet (Median/Q1/Q3/n).
// Die Zellen dienen als Plausibilitätskorridor auf LOS-/GEWERKE-Ebene.
//
// EHRLICHE GRENZE (28-RESEARCH, nicht verhandelbar): Einheitspreise je LV-Position sind
// aus öffentlichen Vergabedaten strukturell NICHT verfügbar — das eForms-SDK kennt
// 0 von 1.256 Feldern mit „price“, alle 26 Geldwertfelder sind repeatable=false, und
// § 14a VOB/A sperrt die Veröffentlichung bepreister LVs. Zellen dieser Lib dürfen
// deshalb NIE als €/Einheit interpretiert, formatiert oder in Kalkulationsfelder
// vorbelegt werden. Feld `ebene: "los"` macht das explizit.
//
// LIZENZEN:
// - TED: Beschluss 2011/833/EU — Weiterverwendung erlaubt, Quellenangabe
//   („© Europäische Union“) und Kennzeichnung von Änderungen (hier: „Daten aggregiert
//   und gefiltert“) sind Pflicht.
// - DÖE: CC0 bzw. amtliches Werk (§ 5 UrhG) — frei nutzbar.
// - DSGVO: Es werden AUSSCHLIESSLICH Aggregat-Zellen gebildet (CPV, Wert-Statistik,
//   Region, Jahr, n). Namen (winner-name / organisationName) werden weder geparst
//   noch gespeichert; organisation.csv wird gar nicht erst importiert.
//
// [ASSUMED] Parallel-Array-Näherung: Die TED-Search-API liefert je Notice unverknüpfte
// Parallel-Arrays (mehrere CPV-/NUTS-/Wert-Einträge ohne Los-Zuordnung). Näherung:
// je tender-value-Eintrag ein Los-Wert; CPV = erster 45*-Code der Notice; NUTS =
// erster DE*-Code der Notice. Für Gruppen-Aggregate auf 4-Steller-Ebene ist der
// dadurch entstehende Fehler klein, einzelne Lose können aber falsch zugeordnet sein.
//
// [ASSUMED] TRADE_CPV: Das Mapping der internen Gewerke (Phase 25) auf CPV-Codes ist
// eine redaktionelle Näherung und bewusst überschreibbar (unbekannt → 45000000).
//
// Self-contained (KEINE Imports) — node-smoke-testbar per `node -e "import(...)"`.

// --- NUTS-1 → Bundesland -----------------------------------------------------
export const NUTS1_LABELS = {
  DE1: "Baden-Württemberg",
  DE2: "Bayern",
  DE3: "Berlin",
  DE4: "Brandenburg",
  DE5: "Bremen",
  DE6: "Hamburg",
  DE7: "Hessen",
  DE8: "Mecklenburg-Vorpommern",
  DE9: "Niedersachsen",
  DEA: "Nordrhein-Westfalen",
  DEB: "Rheinland-Pfalz",
  DEC: "Saarland",
  DED: "Sachsen",
  DEE: "Sachsen-Anhalt",
  DEF: "Schleswig-Holstein",
  DEG: "Thüringen",
};

// NUTS-Code beliebiger Tiefe → Bundesland-Label; unbekannt/„DEU“/leer → "DE" (bundesweit).
export function bundeslandFromNuts(nuts) {
  if (typeof nuts !== "string" || nuts.length < 3) return "DE";
  return NUTS1_LABELS[nuts.slice(0, 3).toUpperCase()] || "DE";
}

// --- CPV ----------------------------------------------------------------------
// [ASSUMED] Gewerk (Phase-25-trade) → repräsentativer CPV-Code.
export const TRADE_CPV = {
  Rohbau: "45210000",
  Ausbau: "45400000",
  Fassade: "45443000",
  TGA: "45331000",
  Dach: "45261000",
  Erdarbeiten: "45112000",
  Trockenbau: "45421141",
};

// Deutsche Kurzlabels je CPV-4-Steller (Fallback: „CPV {group}0000“).
export const CPV_LABELS = {
  4500: "Bauarbeiten (allgemein)",
  4511: "Abbruch- und Erdarbeiten",
  4521: "Hochbau/Rohbau",
  4523: "Tief- und Straßenbau",
  4526: "Dach- und Spezialbau",
  4531: "Elektroinstallation",
  4533: "Heizung/Lüftung/Sanitär",
  4540: "Ausbauarbeiten",
  4542: "Zimmer- und Trockenbau",
  4544: "Maler- und Fassadenarbeiten",
};

// CPV-Code → 4-Steller-Gruppe; nur Bau (CPV 45*), alles andere → null.
export function cpvGroup(cpv) {
  const s = String(cpv || "").trim();
  if (!/^45\d{2}/.test(s)) return null;
  return s.slice(0, 4);
}

// --- RFC-4180-CSV-Parser (Zeichen-Automat, KEIN split) --------------------------
// Unterstützt: quotierte Felder mit eingebetteten Kommas UND Zeilenumbrüchen,
// doppelte Quotes ("" → "), CRLF/LF. Rückgabe { header, rows } — Zeilen als
// Objekte über Header-Namen (additiv-tolerant gegenüber neuen Spalten).
export function parseCsv(text) {
  const records = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  const src = String(text || "");
  const pushField = () => { record.push(field); field = ""; };
  const pushRecord = () => { pushField(); records.push(record); record = []; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRecord();
    } else if (ch === "\r") {
      // CRLF: \n im nächsten Durchlauf erledigt den Record; einzelnes \r ignorieren.
      if (src[i + 1] !== "\n") pushRecord();
    } else {
      field += ch;
    }
  }
  // Letzter Record ohne abschließenden Zeilenumbruch.
  if (field.length > 0 || record.length > 0) pushRecord();
  // Leere Schlusszeilen entfernen.
  const clean = records.filter((r) => r.length > 1 || (r[0] || "").trim() !== "");
  const header = (clean.shift() || []).map((h) => h.trim());
  const rows = clean.map((r) => {
    const obj = {};
    header.forEach((h, idx) => { obj[h] = r[idx] ?? ""; });
    return obj;
  });
  return { header, rows };
}

// --- TED-Search-API v3 ---------------------------------------------------------
// Query-Body für POST https://api.ted.europa.eu/v3/notices/search (kein Key).
// Limits der API: limit ≤ 250, page×limit ≤ 15.000.
export function buildTedQuery({ year, page = 1, limit = 250 } = {}) {
  const y = Number(year) || new Date().getFullYear();
  return {
    query:
      `classification-cpv=45* AND buyer-country IN (DEU) AND notice-type IN (can-standard)` +
      ` AND publication-date=(${y}0101<>${y}1231) AND tender-value>=0`,
    fields: [
      "publication-number", "tender-value", "tender-value-cur", "total-value",
      "classification-cpv", "place-of-performance", "publication-date",
    ],
    limit: Math.min(Number(limit) || 250, 250),
    page: Math.max(1, Number(page) || 1),
    scope: "ALL",
  };
}

// TED-Antwort → normalisierte Lose { value, cpv, nuts, year }.
// [ASSUMED] Parallel-Arrays: je tender-value-Eintrag ein Los; CPV = erster 45*-Code,
// NUTS = erster DE*-Code (siehe Kopfkommentar). Nicht-EUR verworfen; wirft nie.
export function parseTedResponse(json, year) {
  const lots = [];
  const notices = Array.isArray(json?.notices) ? json.notices : [];
  for (const n of notices) {
    try {
      const values = Array.isArray(n["tender-value"]) ? n["tender-value"]
        : n["tender-value"] != null ? [n["tender-value"]] : [];
      if (!values.length) continue;
      const cpvs = Array.isArray(n["classification-cpv"]) ? n["classification-cpv"]
        : n["classification-cpv"] ? [n["classification-cpv"]] : [];
      const cpv = cpvs.find((c) => cpvGroup(c) !== null);
      if (!cpv) continue; // kein Bau-CPV → Notice verwerfen
      const places = Array.isArray(n["place-of-performance"]) ? n["place-of-performance"]
        : n["place-of-performance"] ? [n["place-of-performance"]] : [];
      const nuts = places.find((p) => typeof p === "string" && p.toUpperCase().startsWith("DE")) || null;
      const curs = Array.isArray(n["tender-value-cur"]) ? n["tender-value-cur"]
        : n["tender-value-cur"] ? [n["tender-value-cur"]] : [];
      values.forEach((v, i) => {
        const cur = (curs[i] || curs[0] || "EUR").toUpperCase();
        if (cur !== "EUR") return; // nur EUR-Werte
        const value = Number(v);
        if (!Number.isFinite(value)) return;
        lots.push({ value, cpv: String(cpv), nuts, year: Number(year) || null });
      });
    } catch {
      // defekte Notice überspringen — nie werfen
    }
  }
  return lots;
}

// --- DÖE-Bulk-CSV (CC0) ----------------------------------------------------------
// Join über noticeIdentifier: tender.csv (Werte) × classification.csv (CPV) ×
// placeOfPerformance.csv (NUTS) × optional receivedSubmissions.csv (Bieterzahl).
// Höchste noticeVersion je noticeIdentifier gewinnt; Dedupe über
// (noticeIdentifier, tenderId); nur CPV 45*; nicht-EUR (falls Spalte gefüllt) raus.
export function parseDoeeCsv({ tenderCsv, classificationCsv, placeCsv, submissionsCsv, year } = {}) {
  const tenders = parseCsv(tenderCsv || "").rows;
  const classif = parseCsv(classificationCsv || "").rows;
  const places = parseCsv(placeCsv || "").rows;
  const subs = submissionsCsv ? parseCsv(submissionsCsv).rows : [];

  // Lookups (erster Treffer je noticeIdentifier genügt für CPV/NUTS/Bieter).
  const cpvByNotice = new Map();
  for (const r of classif) {
    const id = r.noticeIdentifier;
    if (id && !cpvByNotice.has(id) && r.mainClassificationCode) {
      cpvByNotice.set(id, r.mainClassificationCode.trim());
    }
  }
  const nutsByNotice = new Map();
  for (const r of places) {
    const id = r.noticeIdentifier;
    if (id && !nutsByNotice.has(id) && r.placePerformanceCountrySubdivision) {
      nutsByNotice.set(id, r.placePerformanceCountrySubdivision.trim());
    }
  }
  const biddersByNotice = new Map();
  for (const r of subs) {
    const id = r.noticeIdentifier;
    const c = Number(r.receivedSubmissionsCount);
    if (id && Number.isFinite(c) && !biddersByNotice.has(id)) biddersByNotice.set(id, c);
  }

  // Höchste noticeVersion je noticeIdentifier gewinnt.
  const maxVersion = new Map();
  for (const r of tenders) {
    const id = r.noticeIdentifier;
    if (!id) continue;
    const v = Number(r.noticeVersion) || 0;
    if (!maxVersion.has(id) || v > maxVersion.get(id)) maxVersion.set(id, v);
  }

  const lots = [];
  const seen = new Set(); // Dedupe (noticeIdentifier, tenderId)
  for (const r of tenders) {
    const id = r.noticeIdentifier;
    if (!id) continue;
    if ((Number(r.noticeVersion) || 0) !== maxVersion.get(id)) continue;
    const key = `${id} ${r.tenderId || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cur = (r.tenderValueCurrency || "").trim().toUpperCase();
    if (cur && cur !== "EUR") continue;
    const value = Number(r.tenderValue);
    if (!Number.isFinite(value)) continue;
    const cpv = cpvByNotice.get(id);
    if (cpvGroup(cpv) === null) continue; // nur Bau (CPV 45*)
    const lot = {
      value,
      cpv,
      nuts: nutsByNotice.get(id) || null,
      year: Number(year) || null,
    };
    if (biddersByNotice.has(id)) lot.bidders = biddersByNotice.get(id);
    lots.push(lot);
  }
  return lots;
}

// --- Aggregation -----------------------------------------------------------------
// Quartil-Konvention (deterministisch, im Smoke-Test verankert): Werte sortieren;
// Median = mittleres Element bzw. Mittel der beiden mittleren; Q1/Q3 = Median der
// unteren/oberen Hälfte, bei ungerader Länge EXKLUSIVE des Medians (Tukey-Hinges-Nähe).
function medianOf(sorted) {
  const n = sorted.length;
  if (!n) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Lose → Benchmark-Zellen CPV-Gruppe × Bundesland × Jahr.
// Pflicht-Datenhygiene (28-RESEARCH §3): Platzhalter value < 1.000 EUR raus,
// nicht-endliche Werte raus; median/q1/q3/min/max auf ganze Euro gerundet.
export function aggregateLots(lots, { source = "demo", fetched_at = null } = {}) {
  const groups = new Map();
  for (const lot of Array.isArray(lots) ? lots : []) {
    const value = Number(lot?.value);
    if (!Number.isFinite(value) || value < 1000) continue; // Platzhalterfilter
    const group = cpvGroup(lot?.cpv);
    if (!group) continue;
    const region = bundeslandFromNuts(lot?.nuts);
    const year = Number(lot?.year) || null;
    const key = `${group}|${region}|${year}`;
    if (!groups.has(key)) groups.set(key, { group, region, year, values: [], bidders: [] });
    const g = groups.get(key);
    g.values.push(value);
    if (Number.isFinite(Number(lot?.bidders))) g.bidders.push(Number(lot.bidders));
  }
  const cells = [];
  for (const g of groups.values()) {
    const sorted = [...g.values].sort((a, b) => a - b);
    const n = sorted.length;
    const mid = Math.floor(n / 2);
    const lower = sorted.slice(0, mid);
    const upper = sorted.slice(n % 2 ? mid + 1 : mid);
    cells.push({
      ebene: "los",
      cpv_group: g.group,
      cpv_label: CPV_LABELS[g.group] || `CPV ${g.group}0000`,
      region: g.region,
      year: g.year,
      n,
      median: Math.round(medianOf(sorted)),
      q1: lower.length ? Math.round(medianOf(lower)) : Math.round(sorted[0]),
      q3: upper.length ? Math.round(medianOf(upper)) : Math.round(sorted[n - 1]),
      min: Math.round(sorted[0]),
      max: Math.round(sorted[n - 1]),
      avg_bidders: g.bidders.length
        ? Math.round((g.bidders.reduce((s, b) => s + b, 0) / g.bidders.length) * 10) / 10
        : null,
      currency: "EUR",
      source,
      fetched_at,
    });
  }
  return cells;
}

// --- Benchmark-Lookup ---------------------------------------------------------------
// trade → CPV-Gruppe; Suche exakt (group, region, year), dann region → "DE",
// dann jüngstes verfügbares Jahr der Gruppe (beliebige Region). Wirft nie.
export function benchmarkFor(cells, { trade, region, year } = {}) {
  const list = Array.isArray(cells) ? cells : [];
  const cpv = TRADE_CPV[trade] || "45000000"; // unbekanntes Gewerk → 4500
  const group = cpvGroup(cpv);
  const inGroup = list.filter((c) => c?.cpv_group === group);
  if (!inGroup.length) return { none: true, reason: "keine Zelle für CPV-Gruppe" };
  const y = Number(year) || null;
  let hit = region ? inGroup.find((c) => c.region === region && c.year === y) : null;
  if (hit) return { cell: hit, exact: true };
  hit = inGroup.find((c) => c.region === "DE" && c.year === y);
  if (hit) return { cell: hit, exact: false };
  // Fallback: jüngstes verfügbares Jahr (Region-Präferenz: gewünschte Region > DE > beliebig).
  const sorted = [...inGroup].sort((a, b) => (b.year || 0) - (a.year || 0));
  hit = (region && sorted.find((c) => c.region === region))
    || sorted.find((c) => c.region === "DE")
    || sorted[0];
  return { cell: hit, exact: false };
}

// --- Korridor-Text (Vertrauensstufen, 28-RESEARCH §5) -------------------------------
// n ≥ 20 → Median + Q1–Q3-Spanne; 5 ≤ n < 20 → nur Median + n (KEINE Spanne);
// n < 5 → null (keine Zahl). Format de-DE als T€ — NIE €/Einheit, NIE Mittelwert.
const tEur = (v) => `${Math.round((v || 0) / 1000).toLocaleString("de-DE")} T€`;

export function korridorText(cell) {
  if (!cell || !Number.isFinite(cell.n) || cell.n < 5) return null;
  if (cell.n >= 20) {
    return `Median ${tEur(cell.median)} · Spanne ${tEur(cell.q1)}–${tEur(cell.q3)} (Q1–Q3) · n=${cell.n}`;
  }
  return `Median ${tEur(cell.median)} · n=${cell.n} (zu wenig Zuschläge für Quartilsspanne)`;
}

// --- Demo-Korpus: VERSCHOBEN (Phase 33 / W3) -----------------------------------------
// `DEMO_BENCHMARKS` stand hier als Konstante und wurde per Knopf in das gerade
// geöffnete Projekt geschrieben — also auch in ein echtes. Die Werte liegen jetzt als
// Daten im isolierten Demoprojekt (`server/demo-data.js`, jeder Satz mit
// `source: "demo"` und `demo: true`) und werden mit `npm run seed` angelegt.
// Sonst ist an dieser Datei NICHTS geändert: TED/DÖE bleiben Marktkontext auf
// LOS-Ebene und werden nie zu €/Einheit umgedeutet — diese Grenze ist ein Merkmal,
// kein Mangel.
