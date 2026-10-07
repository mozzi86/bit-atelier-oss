// lieferplan.js — Modelllieferplan und Übergabeprotokoll (Phase 71-03).
//
// Das LV (5.1.10) verlangt zu Beginn einen verbindlichen Modelllieferplan,
// nennt aber keinen festen Turnus — nur drei Anker (HANDOFF-ROHBAU-BIM §0/§1):
//   Erstlieferung LoG 300  vier Wochen nach Beauftragung,
//   LoG 400 je Bauabschnitt drei Wochen vor Produktionsbeginn,
//   As-Built LoG 500        vier Wochen nach Rohbauende.
//
// Der Plan lebt im Projekt als exklusives BimModel-Feld `lieferung_layer`
// (Registry in @designer/lib/useFachlayer.js). Dieses Modul kennt keinen
// React-State und keine API — reine Funktionen über dem Layer, damit Soll/Ist
// und Protokolltext in Node testbar sind.
//
// Schema:
//   lieferung_layer = {
//     fachsicht: 'TX',                       // Richtlinien-Fachsicht des Rohbau-AN (Default TX, mit GP abstimmen)
//     lieferungen: [{
//       id, nr, termin: 'YYYY-MM-DD', bauabschnitt, log: 300|400|500,
//       status: 'geplant'|'geliefert'|'geprueft'|'freigegeben',
//       dateiname: string|null, datum_ist: 'YYYY-MM-DD'|null,
//       bemerkung: string,     // intern — NICHT im Protokoll (T-71-12)
//       hinweis_ag: string,    // geht ins Übergabeprotokoll
//     }]
//   }
//
// Datumsarithmetik ausschließlich auf ISO-Tagen (UTC), damit Sommerzeit und
// Zeitzone des Browsers das Soll/Ist nicht um einen Tag verschieben.

/** Fachsicht des Rohbau-AN — im LV nicht festgelegt, TX naheliegend (71-03 Kontext). */
export const FACHSICHT_DEFAULT = "TX";

/** LoG-Stufen der Leistungsbeschreibung mit Klartext. */
export const LOG_STUFEN = Object.freeze([
  { wert: 300, text: "LoG 300 — Erstlieferung (Ausführungsplanung Rohbau)" },
  { wert: 400, text: "LoG 400 — Produktions-/Montagemodell je Bauabschnitt" },
  { wert: 500, text: "LoG 500 — As-Built nach Rohbauende" },
]);

/** Status-Kette einer Lieferung (in dieser Reihenfolge). */
export const LIEFER_STATUS = Object.freeze(["geplant", "geliefert", "geprueft", "freigegeben"]);

export const STATUS_TEXT = Object.freeze({
  geplant: "geplant",
  geliefert: "geliefert",
  geprueft: "geprüft",
  freigegeben: "freigegeben",
});

const TAG_MS = 86400000;

/** ISO-Datum (YYYY-MM-DD) aus Date/String; ungültig → null. */
export function isoTag(wert) {
  if (wert == null || wert === "") return null;
  if (typeof wert === "string" && /^\d{4}-\d{2}-\d{2}$/.test(wert)) return wert;
  const d = wert instanceof Date ? wert : new Date(wert);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Tage von `von` bis `bis` (ISO-Strings), positiv wenn `bis` später liegt. */
export function tageZwischen(von, bis) {
  const a = isoTag(von);
  const b = isoTag(bis);
  if (!a || !b) return null;
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
    - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / TAG_MS);
}

/** ISO-Datum plus n Tage. */
export function plusTage(iso, tage) {
  const a = isoTag(iso);
  if (!a) return null;
  const ms = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) + tage * TAG_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Deutsches Datum (TT.MM.JJJJ) aus ISO; null → "—". */
export function datumText(iso) {
  const a = isoTag(iso);
  return a ? `${a.slice(8, 10)}.${a.slice(5, 7)}.${a.slice(0, 4)}` : "—";
}

export function leeresLieferungLayer() {
  return { fachsicht: FACHSICHT_DEFAULT, lieferungen: [] };
}

/** Layer aus dem BimModel normalisieren (fehlende Felder, fremde Werte). */
export function normalisiereLayer(roh) {
  const basis = leeresLieferungLayer();
  if (!roh || typeof roh !== "object") return basis;
  const fachsicht = typeof roh.fachsicht === "string" && /^[A-Z]{2}$/.test(roh.fachsicht)
    ? roh.fachsicht : FACHSICHT_DEFAULT;
  const lieferungen = Array.isArray(roh.lieferungen)
    ? roh.lieferungen.filter((l) => l && typeof l === "object").map((l, i) => ({
      id: String(l.id || `L${i + 1}`),
      nr: Number.isInteger(l.nr) ? l.nr : i + 1,
      termin: isoTag(l.termin),
      bauabschnitt: String(l.bauabschnitt || ""),
      log: [300, 400, 500].includes(Number(l.log)) ? Number(l.log) : 300,
      status: LIEFER_STATUS.includes(l.status) ? l.status : "geplant",
      dateiname: l.dateiname ? String(l.dateiname) : null,
      datum_ist: isoTag(l.datum_ist),
      bemerkung: String(l.bemerkung || ""),
      hinweis_ag: String(l.hinweis_ag || ""),
    }))
    : [];
  return { fachsicht, lieferungen };
}

function neueId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Lieferung anhängen — nr = max(nr)+1, Status geplant.
 * @returns {{layer: object, lieferung: object}} neuer Layer (immutable) + die neue Lieferung
 */
export function lieferungAnlegen(layer, { termin = null, bauabschnitt = "", log = 300, bemerkung = "", hinweis_ag = "" } = {}) {
  const basis = normalisiereLayer(layer);
  const nr = basis.lieferungen.reduce((m, l) => Math.max(m, l.nr), 0) + 1;
  const lieferung = {
    id: neueId(), nr, termin: isoTag(termin), bauabschnitt: String(bauabschnitt || ""),
    log: [300, 400, 500].includes(Number(log)) ? Number(log) : 300,
    status: "geplant", dateiname: null, datum_ist: null,
    bemerkung: String(bemerkung || ""), hinweis_ag: String(hinweis_ag || ""),
  };
  return { layer: { ...basis, lieferungen: [...basis.lieferungen, lieferung] }, lieferung };
}

/** Felder einer Lieferung ändern (immutable). */
export function lieferungAendern(layer, id, patch) {
  const basis = normalisiereLayer(layer);
  return {
    ...basis,
    lieferungen: basis.lieferungen.map((l) => (l.id === id ? { ...l, ...patch } : l)),
  };
}

export function lieferungLoeschen(layer, id) {
  const basis = normalisiereLayer(layer);
  return { ...basis, lieferungen: basis.lieferungen.filter((l) => l.id !== id) };
}

/**
 * Paket erzeugt → Lieferung auf `geliefert` mit Ist-Datum und Dateiname.
 * Ein späterer Status (geprüft/freigegeben) wird NICHT zurückgesetzt — nur
 * Dateiname und Ist-Datum werden nachgetragen.
 */
export function markiereGeliefert(layer, id, { dateiname, datum_ist }) {
  const basis = normalisiereLayer(layer);
  return {
    ...basis,
    lieferungen: basis.lieferungen.map((l) => {
      if (l.id !== id) return l;
      const status = l.status === "geplant" ? "geliefert" : l.status;
      return { ...l, status, dateiname: dateiname || l.dateiname, datum_ist: isoTag(datum_ist) || l.datum_ist };
    }),
  };
}

/**
 * Vorlage nach der Leistungsbeschreibung aus drei Ankern.
 * @param {object} layer bestehender lieferung_layer (oder null)
 * @param {{beauftragung: string, bauabschnitte?: Array<{name: string, produktionsbeginn: string}>,
 *   rohbauende?: string}} anker ISO-Daten
 * @returns {object} Layer mit den erzeugten Lieferungen (bestehende bleiben)
 */
export function planVorlage(layer, anker) {
  const { beauftragung, bauabschnitte = [], rohbauende = null } = anker;
  let akt = normalisiereLayer(layer);
  const start = isoTag(beauftragung);
  if (start) {
    akt = lieferungAnlegen(akt, {
      termin: plusTage(start, 28), log: 300, bauabschnitt: "gesamt",
      hinweis_ag: "Erstlieferung LoG 300 — vier Wochen nach Beauftragung (Vertragsvorgabe)",
    }).layer;
  }
  for (const ba of bauabschnitte) {
    const pb = isoTag(ba?.produktionsbeginn);
    if (!pb) continue;
    akt = lieferungAnlegen(akt, {
      termin: plusTage(pb, -21), log: 400, bauabschnitt: String(ba.name || ""),
      hinweis_ag: "LoG 400 — drei Wochen vor Produktionsbeginn des Bauabschnitts (Vertragsvorgabe)",
    }).layer;
  }
  const ende = isoTag(rohbauende);
  if (ende) {
    akt = lieferungAnlegen(akt, {
      termin: plusTage(ende, 28), log: 500, bauabschnitt: "gesamt",
      hinweis_ag: "As-Built LoG 500 — vier Wochen nach Rohbauende (Vertragsvorgabe)",
    }).layer;
  }
  return akt;
}

/**
 * Soll/Ist je Lieferung zu einem festen `heute`.
 *
 * geplant:    faellig = heute ≥ termin; verzug_tage = heute − termin (nur > 0)
 * geliefert+: verzug_tage = datum_ist − termin (nur > 0), faellig = false
 * ampel:      rot bei Verzug, gelb ≤ 7 Tage vor Termin (offen), sonst gruen;
 *             grau ohne Termin.
 *
 * @param {object} layer
 * @param {string|Date} heute
 * @returns {Array<object>} Lieferungen (nach termin sortiert) + { faellig, verzug_tage, ampel }
 */
export function sollIst(layer, heute) {
  const h = isoTag(heute) || isoTag(new Date());
  const basis = normalisiereLayer(layer);
  const liste = basis.lieferungen.map((l) => {
    let faellig = false;
    let verzug = 0;
    let ampel = "grau";
    if (l.termin) {
      if (l.status === "geplant") {
        const diff = tageZwischen(l.termin, h); // > 0: überfällig
        faellig = diff >= 0;
        verzug = Math.max(0, diff);
        ampel = verzug > 0 ? "rot" : (-diff <= 7 ? "gelb" : "gruen");
      } else {
        const diff = l.datum_ist ? tageZwischen(l.termin, l.datum_ist) : 0;
        verzug = Math.max(0, diff || 0);
        ampel = verzug > 0 ? "rot" : "gruen";
      }
    }
    return { ...l, faellig, verzug_tage: verzug, ampel };
  });
  liste.sort((a, b) => String(a.termin || "9999").localeCompare(String(b.termin || "9999")) || a.nr - b.nr);
  return liste;
}

/**
 * Nächste offene Lieferung: die früheste `geplant`e — überfällige zuerst.
 * @returns {object|null}
 */
export function naechsteLieferung(layer, heute) {
  const offen = sollIst(layer, heute).filter((l) => l.status === "geplant");
  return offen[0] || null;
}

function zeile(k, v) {
  return `| ${k} | ${v == null || v === "" ? "—" : String(v)} |`;
}

/**
 * Übergabeprotokoll als Markdown — alle Pflichtfelder der Übergabe (LV 5.1.3,
 * BAP 8.1.2): Projekt, Lieferung (Soll/Ist), Modell, Prüfung, Herkunft, Prüfer,
 * Hashes. `bemerkung` (intern) wird bewusst NICHT ausgegeben (T-71-12), nur
 * `hinweis_ag`.
 *
 * @param {{projekt?: {name?: string, bauherr?: string, nummer?: string},
 *   lieferung?: object|null, modell?: {dateiname?: string, dateinameOriginal?: string,
 *   schema?: string, geschosse?: string[]|number, klassen?: Record<string, number>, bytes?: number},
 *   pruefung?: {ids?: {bestanden: number, verletzt: number}, clash?: {befunde: number, geprueft: number, uebersprungen?: number},
 *   koordination?: {bestanden: boolean|null, maxMm?: number, grund?: string}|null, warnungen?: string[]},
 *   herkunft: string, pruefer: string, erzeugt?: string|Date, hashes?: Array<{name: string, sha256: string}>}} p
 * @returns {string} Markdown
 */
export function protokollText({ projekt = {}, lieferung = null, modell = {}, pruefung = {}, herkunft, pruefer, erzeugt, hashes = [] }) {
  const zeit = erzeugt ? new Date(erzeugt) : new Date();
  const zeitText = Number.isNaN(zeit.getTime()) ? String(erzeugt) : zeit.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const klassen = modell.klassen && typeof modell.klassen === "object"
    ? Object.entries(modell.klassen).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    : [];
  const geschosse = Array.isArray(modell.geschosse) ? modell.geschosse.length : modell.geschosse;

  const teile = [
    `# Übergabeprotokoll Modelllieferung`,
    ``,
    `Erzeugt: ${zeitText} · Prüfer: ${pruefer || "—"}`,
    ``,
    `## Projekt`,
    ``,
    `| Feld | Wert |`,
    `|---|---|`,
    zeile("Projekt", projekt.name),
    zeile("Bauherr", projekt.bauherr),
    zeile("Projektnummer", projekt.nummer),
    ``,
    `## Lieferung`,
    ``,
    `| Feld | Wert |`,
    `|---|---|`,
    zeile("Lieferung Nr.", lieferung ? lieferung.nr : null),
    zeile("Bauabschnitt", lieferung ? lieferung.bauabschnitt : null),
    zeile("LoG", lieferung ? lieferung.log : null),
    zeile("Termin (Soll)", lieferung ? datumText(lieferung.termin) : null),
    zeile("Geliefert (Ist)", lieferung ? datumText(lieferung.datum_ist || erzeugt) : null),
    zeile("Status", lieferung ? STATUS_TEXT[lieferung.status] || lieferung.status : null),
    zeile("Hinweis an den AG", lieferung ? lieferung.hinweis_ag : null),
    ``,
    `## Modell`,
    ``,
    `| Feld | Wert |`,
    `|---|---|`,
    zeile("Dateiname (Namenskonvention)", modell.dateiname),
    zeile("Ausgangsdatei", modell.dateinameOriginal),
    zeile("IFC-Schema", modell.schema),
    zeile("Geschosse", geschosse),
    zeile("Größe (Bytes)", modell.bytes),
    zeile("Herkunft", herkunft),
    ``,
  ];
  if (klassen.length) {
    teile.push(`### Bauteile je Klasse`, ``, `| Klasse | Anzahl |`, `|---|---|`);
    for (const [k, n] of klassen) teile.push(`| ${k} | ${n} |`);
    teile.push(``);
  }
  teile.push(`## Prüfung`, ``, `| Feld | Wert |`, `|---|---|`);
  const ids = pruefung.ids || /** @type {{bestanden?: number, verletzt?: number}} */ ({});
  const clash = pruefung.clash || /** @type {{befunde?: number, geprueft?: number, uebersprungen?: number}} */ ({});
  teile.push(zeile("IDS bestanden / verletzt", ids.bestanden == null ? null : `${ids.bestanden} / ${ids.verletzt ?? 0}`));
  teile.push(zeile("Kollisions-Befunde", clash.befunde));
  teile.push(zeile("Geprüfte Paare", clash.geprueft));
  if (clash.uebersprungen) teile.push(zeile("Übersprungen (Cap)", clash.uebersprungen));
  const ko = pruefung.koordination;
  teile.push(zeile("Koordinationskörper", ko == null ? "nicht geprüft (Ein-Modell-Lauf)"
    : ko.bestanden === null ? `offen — ${ko.grund || "Körper fehlt"}`
      : ko.bestanden ? `Lage bestätigt (max. ${ko.maxMm ?? 0} mm)` : `Abweichung ${ko.maxMm} mm`));
  teile.push(``);
  if (Array.isArray(pruefung.warnungen) && pruefung.warnungen.length) {
    teile.push(`### Hinweise`, ``);
    for (const w of pruefung.warnungen) teile.push(`- ${w}`);
    teile.push(``);
  }
  if (hashes.length) {
    teile.push(`## Prüfsummen (SHA-256)`, ``, `| Datei | SHA-256 |`, `|---|---|`);
    for (const h of hashes) teile.push(`| ${h.name} | ${h.sha256} |`);
    teile.push(``);
  }
  teile.push(
    `---`,
    `Automatisch erzeugt von der Prüf-Suite. Geometrische und semantische Befunde sind`,
    `Verdachtsmomente (AABB-/Dreiecks-Verfahren, buildingSMART IDS 1.0) und ersetzen`,
    `nicht die fachliche Bewertung durch die BIM-Koordination.`,
    ``,
  );
  return teile.join("\n");
}
