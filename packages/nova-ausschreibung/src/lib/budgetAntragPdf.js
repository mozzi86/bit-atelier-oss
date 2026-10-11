// 90-10: request for a budget increase of one DIN 276 cost group as an A4 PDF draft (jspdf, dynamic import).
// Content: project, KG, current budget, prognosis, requested budget and increase, justification, proposed
// cover (Deckung), blank signature lines for planner and client. "ENTWURF", no office stamp or signature.
//
// In:  { projekt, zeile (kostenJeKg row), budget_neu, begruendung, deckung, jetzt }.
// Out: { bytes: Uint8Array, dateiname } — the caller downloads; tests read the uncompressed text.

const fmt = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €" : "—");

/**
 * @param {{projekt?: any, zeile: {kg: string, bezeichnung: string, budget: number, vergabe: number, prognose: number, abweichung: number},
 *   budget_neu: number, begruendung: string, deckung?: string, jetzt?: Date}} p
 * @returns {Promise<{bytes: Uint8Array, dateiname: string}>}
 */
export async function budgetAntragPdf({ projekt = null, zeile, budget_neu, begruendung, deckung = "", jetzt = new Date() }) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const L = 20, B = 175;
  // Watermark first so it lies under the content (see 90-05).
  pdf.setFontSize(60); pdf.setTextColor(238); pdf.text("ENTWURF", 105, 160, { align: "center", angle: 35 }); pdf.setTextColor(0);
  let y = 22;
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(15); pdf.text("Antrag auf Budgeterhöhung", L, y); y += 9;
  pdf.setFontSize(9);
  const kopf = [["Projekt", projekt?.name], ["Bauherr", projekt?.client], ["Kostengruppe", `${zeile.kg} ${zeile.bezeichnung || ""}`.trim()], ["Datum", jetzt.toLocaleDateString("de-DE")]];
  for (const [k, v] of kopf) {
    if (!v) continue;
    pdf.setFont("helvetica", "bold"); pdf.text(`${k}:`, L, y); pdf.setFont("helvetica", "normal"); pdf.text(String(v), L + 35, y); y += 5.5;
  }
  y += 4;
  const erhoehung = Math.round((budget_neu - zeile.budget) * 100) / 100;
  const tabelle = [["Budget bisher", fmt(zeile.budget)], ["Vergabesumme", fmt(zeile.vergabe)], ["Kostenprognose", fmt(zeile.prognose)],
    ["Beantragtes Budget", fmt(budget_neu)], ["Erhöhung", fmt(erhoehung)]];
  pdf.setDrawColor(80); pdf.setLineWidth(0.3);
  tabelle.forEach(([k, v], i) => {
    const fett = i >= 3;
    pdf.setFont("helvetica", fett ? "bold" : "normal"); pdf.setFontSize(10);
    pdf.text(k, L + 1, y + 4.5); pdf.text(v, L + 100, y + 4.5, { align: "right" });
    pdf.line(L, y + 6.5, L + 100, y + 6.5); y += 7;
  });
  y += 6;
  const abschnitt = (titel, text) => {
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.text(titel, L, y); y += 6;
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(9.5);
    for (const z of pdf.splitTextToSize(String(text || "______"), B)) { pdf.text(z, L, y); y += 4.6; }
    y += 4;
  };
  abschnitt("Begründung", begruendung);
  abschnitt("Deckungsvorschlag", deckung || "______");
  y = Math.max(y + 14, 230);
  pdf.setLineWidth(0.2); pdf.line(L, y, L + 75, y); pdf.line(L + 95, y, L + 170, y);
  pdf.setFontSize(8); pdf.text("Ort, Datum, aufgestellt (Planer)", L, y + 4); pdf.text("Ort, Datum, genehmigt (Bauherr)", L + 95, y + 4);
  pdf.setFontSize(7); pdf.setTextColor(120);
  pdf.text(`ENTWURF – ohne Unterschrift · erstellt ${jetzt.toLocaleDateString("de-DE")}`, L, 289); pdf.setTextColor(0);
  const safe = String(projekt?.name || "Projekt").replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40);
  return { bytes: new Uint8Array(pdf.output("arraybuffer")), dateiname: `Budgeterhoehung_KG${zeile.kg}_${safe}_Entwurf.pdf` };
}
