// 90-08: meeting minutes as A4 PDF (jspdf, dynamic import): header (project, title + number, date, place),
// participants with presence, items with number, kind (I/F/A), topic + text, responsible party, deadline,
// status (overdue tasks marked), next meeting, distribution list, note. No office data.
//
// In:  minutes record (see protokoll.js), project, `heute` for the overdue mark.
// Out: { bytes: Uint8Array, dateiname }.

import { PUNKT_ARTEN, punktNummern, ueberfaellig } from "./protokoll.js";

const S = Object.freeze({ w: 210, h: 297, l: 20, r: 15, o: 15, u: 18 });
const de = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString("de-DE", { timeZone: "UTC" }) : "");

/**
 * @param {any} p minutes record
 * @param {{name?: string}|null} projekt
 * @param {{heute?: Date}} [o]
 * @returns {Promise<{bytes: Uint8Array, dateiname: string}>}
 */
export async function protokollPdf(p, projekt, { heute = new Date() } = {}) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const B = S.w - S.l - S.r;
  let y = S.o;
  const platz = (h) => { if (y + h > S.h - S.u) { pdf.addPage(); y = S.o; } };
  const titel = (t) => { platz(10); pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.text(t, S.l, y + 5); y += 8; pdf.setFont("helvetica", "normal"); };

  pdf.setFont("helvetica", "bold"); pdf.setFontSize(15);
  pdf.text(`Protokoll Nr. ${p.nummer} – ${p.titel || "Besprechung"}`, S.l, y + 6); y += 11;
  pdf.setFontSize(9);
  for (const [k, v] of [["Projekt", projekt?.name], ["Datum", de(p.datum)], ["Ort", p.ort]]) {
    if (!v) continue;
    pdf.setFont("helvetica", "bold"); pdf.text(`${k}:`, S.l, y + 4); pdf.setFont("helvetica", "normal"); pdf.text(String(v), S.l + 25, y + 4); y += 5;
  }
  y += 3;

  titel("Teilnehmer");
  pdf.setFontSize(8.5);
  const tn = p.teilnehmer || [];
  if (!tn.length) { pdf.text("—", S.l, y + 4); y += 6; }
  for (const t of tn) {
    platz(5);
    pdf.text(`${t.anwesend === false ? "( ) " : "(x) "}${t.name}${t.firma ? ` – ${t.firma}` : ""}${t.anwesend === false ? " (entschuldigt)" : ""}`, S.l, y + 4); y += 4.6;
  }
  y += 3;

  titel("Punkte");
  const sp = [{ t: "Nr.", w: 20 }, { t: "Art", w: 9 }, { t: "Thema / Inhalt", w: 85 }, { t: "Zuständig", w: 28 }, { t: "Frist", w: 18 }, { t: "Status", w: 15 }];
  const kopf = () => {
    platz(8); pdf.setFont("helvetica", "bold"); pdf.setFontSize(8);
    let x = S.l; for (const s of sp) { pdf.text(s.t, x + 1, y + 4); x += s.w; }
    pdf.setDrawColor(80); pdf.setLineWidth(0.3); pdf.line(S.l, y + 5.5, S.l + B, y + 5.5); y += 7; pdf.setFont("helvetica", "normal");
  };
  kopf();
  const nr = punktNummern(p);
  const kurz = Object.fromEntries(PUNKT_ARTEN.map((a) => [a.id, a.kurz]));
  (p.punkte || []).forEach((pt, i) => {
    pdf.setFontSize(8);
    const inhalt = pdf.splitTextToSize([pt.thema ? `${pt.thema}:` : "", pt.text || ""].filter(Boolean).join(" "), sp[2].w - 2);
    const zust = pdf.splitTextToSize(String(pt.zustaendig || ""), sp[3].w - 2);
    const h = Math.max(inhalt.length, zust.length, 1) * 3.6 + 1.8;
    if (y + h > S.h - S.u) { pdf.addPage(); y = S.o; kopf(); }
    const spaet = ueberfaellig(pt, heute);
    const status = pt.art === "aufgabe" ? (pt.status === "erledigt" ? "erledigt" : spaet ? "überfällig" : "offen") : "";
    const zellen = [[nr[i]], [kurz[pt.art] || ""], inhalt, zust, [de(pt.frist)], [status]];
    let x = S.l;
    zellen.forEach((z, k) => {
      if (k === 5 && spaet) pdf.setTextColor(185, 28, 28);
      if (z.length && z[0] !== "") pdf.text(z, x + 1, y + 3.4);
      pdf.setTextColor(0);
      x += sp[k].w;
    });
    pdf.setDrawColor(210); pdf.setLineWidth(0.1); pdf.line(S.l, y + h, S.l + B, y + h);
    y += h;
  });
  if (!(p.punkte || []).length) { pdf.setFontSize(8.5); pdf.text("Keine Punkte.", S.l, y + 4); y += 6; }
  y += 2; pdf.setFontSize(7.5); pdf.setTextColor(110);
  pdf.text(`Art: ${PUNKT_ARTEN.map((a) => `${a.kurz} = ${a.label}`).join(", ")}`, S.l, y + 3); pdf.setTextColor(0); y += 7;

  for (const [k, v] of [["Nächster Termin", p.naechster_termin], ["Verteiler", p.verteiler]]) {
    if (!v) continue;
    platz(8); pdf.setFontSize(9); pdf.setFont("helvetica", "bold"); pdf.text(`${k}:`, S.l, y + 4);
    pdf.setFont("helvetica", "normal"); pdf.text(pdf.splitTextToSize(String(v), B - 32), S.l + 32, y + 4); y += 6;
  }
  if (p.hinweis) { platz(10); y += 2; pdf.setFontSize(8); pdf.setTextColor(90); pdf.text(pdf.splitTextToSize(String(p.hinweis), B), S.l, y + 4); pdf.setTextColor(0); }

  const n = pdf.getNumberOfPages();
  for (let i = 1; i <= n; i += 1) {
    pdf.setPage(i); pdf.setFontSize(7); pdf.setTextColor(120);
    pdf.text(`Protokoll Nr. ${p.nummer} · ${de(p.datum)} · Seite ${i} / ${n}`, S.l, S.h - 8); pdf.setTextColor(0);
  }
  const safe = (s) => String(s || "").replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/_+/g, "_").slice(0, 40);
  return { bytes: new Uint8Array(pdf.output("arraybuffer")), dateiname: `Protokoll_${String(p.nummer).padStart(2, "0")}_${safe(p.titel)}_${String(p.datum || "").slice(0, 10)}.pdf` };
}
