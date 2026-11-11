// bitCheckBericht.js — headless Prüfbericht PDF for bit-check (Phase 77).
//
// ModelCheck rasters a DOM node via html2canvas; the CLI has no DOM. This
// writer builds a plain multi-page A4 PDF with jsPDF text APIs only (already
// in package.json — jspdf.node). No new dependency.
//
// In:  kennzahlen + clash/IDS findings (same shapes as ModelCheck). Out: PDF bytes.

import { jsPDF } from "jspdf";

const KIND_LABELS = {
  hard: "Kollision",
  clearance: "Abstand",
  duplicate: "Duplikat",
  enthalten: "nicht größer als (AABB-Näherung)",
  gefuellt: "gefüllt (AABB-Näherung)",
  deckung: "deckungsgleich (AABB-Näherung)",
  ohne_partner: "ohne Gegenstück",
};

/** Max clash rows printed in the PDF (rows); full list stays in BCF/CSV. */
const MAX_ZEILEN = 200;

/**
 * Format a centre point in metres for the report line.
 * @param {{x?: number, y?: number, z?: number}|null|undefined} c
 * @returns {string}
 */
function fmtCenter(c) {
  if (!c) return "—";
  const n = (v) => Number(v || 0).toFixed(2);
  return `(${n(c.x)} / ${n(c.y)} / ${n(c.z)}) m`;
}

/**
 * Build a text-only Prüfbericht PDF (A4 portrait).
 * @param {{
 *   modell?: string,
 *   vergleich?: string|null,
 *   regelsatz?: string|null,
 *   datum?: string,
 *   kennzahlen?: Record<string, number>,
 *   clashes?: object[],
 *   ids?: object[],
 *   vergleichLauf?: {hartZunahme?: number, neu?: object[], behoben?: object[], unveraendert?: object[]}|null,
 * }} p
 * @returns {Uint8Array} PDF bytes
 */
export function schreibeBitCheckPdf(p = {}) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const margin = 14;
  const maxW = pageW - 2 * margin;
  let y = 18;

  const zeile = (text, opt = {}) => {
    const size = opt.size || 10;
    const bold = opt.bold || false;
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(String(text ?? ""), maxW);
    for (const line of lines) {
      if (y > 280) {
        pdf.addPage();
        y = 18;
      }
      pdf.text(line, margin, y);
      y += size * 0.45 + 2;
    }
  };

  const k = p.kennzahlen || {};
  zeile("BIT-Atelier — Prüfbericht (bit-check)", { size: 14, bold: true });
  zeile(`Datum: ${p.datum || new Date().toISOString()}`);
  zeile(`Modell: ${p.modell || "—"}`);
  if (p.vergleich) zeile(`Vergleichsmodell: ${p.vergleich}`);
  if (p.regelsatz) zeile(`Regelsatz: ${p.regelsatz}`);
  y += 2;
  zeile("Kennzahlen", { size: 12, bold: true });
  zeile(`Bauteile (Geometrie): ${k.bauteile ?? "—"}`);
  zeile(`Harte Kollisionen: ${k.hart ?? 0}`);
  zeile(`Duplikate: ${k.duplikate ?? 0}`);
  zeile(`Abstände: ${k.clearance ?? 0}`);
  zeile(`IDS bestanden: ${k.idsBestanden ?? 0} · verletzt: ${k.idsVerletzt ?? 0}`);
  zeile(`Befunde gesamt: ${k.befunde ?? 0}`);

  if (p.vergleichLauf) {
    y += 2;
    zeile("Vergleich mit Vorlauf", { size: 12, bold: true });
    zeile(`Neue Befunde: ${p.vergleichLauf.neu?.length ?? 0}`);
    zeile(`Behoben: ${p.vergleichLauf.behoben?.length ?? 0}`);
    zeile(`Unverändert: ${p.vergleichLauf.unveraendert?.length ?? 0}`);
    zeile(`Zunahme harter Kollisionen: ${p.vergleichLauf.hartZunahme ?? 0}`);
  }

  const clashes = Array.isArray(p.clashes) ? p.clashes : [];
  y += 2;
  zeile(`Kollisionsbefunde (${Math.min(clashes.length, MAX_ZEILEN)} von ${clashes.length})`, {
    size: 12,
    bold: true,
  });
  clashes.slice(0, MAX_ZEILEN).forEach((c, i) => {
    const art = KIND_LABELS[c.kind] || c.kind || "?";
    const vol = c.overlapVol != null ? `${Number(c.overlapVol).toFixed(3)} m³` : "—";
    zeile(
      `${i + 1}. ${art}: ${c.aType || "?"} ↔ ${c.bType || "?"} · ` +
        `${c.aGuid || (c.aId != null ? `#${c.aId}` : "—")} / ${c.bGuid || (c.bId != null ? `#${c.bId}` : "—")} · ` +
        `Überlappung ${vol} @ ${fmtCenter(c.center)}`,
      { size: 8 },
    );
  });
  if (clashes.length > MAX_ZEILEN) {
    zeile(`… ${clashes.length - MAX_ZEILEN} weitere in BCF/CSV.`, { size: 8 });
  }

  const ids = Array.isArray(p.ids) ? p.ids.filter((r) => r && r.bestanden === false) : [];
  y += 2;
  zeile(`IDS-Verletzungen (${ids.length})`, { size: 12, bold: true });
  for (const r of ids) {
    zeile(`${r.spec?.name || "IDS"}: ${r.verletzungen?.length || 0} Verletzung(en)`, { size: 9, bold: true });
    for (const v of (r.verletzungen || []).slice(0, 20)) {
      zeile(
        `  · ${v.globalId || v.elementName || "—"}: erwartet ${v.erwartet}, gefunden ${v.gefunden}`,
        { size: 8 },
      );
    }
  }

  y += 4;
  zeile(
    "Geometrische Verdachtsmomente — fachliche Bewertung erforderlich. Erzeugt ohne Browser (bit-check).",
    { size: 8 },
  );

  return new Uint8Array(pdf.output("arraybuffer"));
}

export { KIND_LABELS as BIT_CHECK_KIND_LABELS };
